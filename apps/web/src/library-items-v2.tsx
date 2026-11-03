// 1CE v2 private library. Never requests v1 data.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Play,Pause,SkipBack,SkipForward,Shuffle,Repeat,Repeat1,ListMusic,Volume2,VolumeX,X,Music2,ChevronLeft,Bookmark,Eye,EyeOff,ListPlus,FolderPlus,Pencil,Image as ImageIcon,Download,Layers,Trash2,ChevronRight,Link2} from 'lucide-react';
import './library-items-v2.css';
import {subscribeV2DataChanges,subscribeV2Resume} from './data-refresh-v2';
import useProjectFlagsV2 from './project-flags-v2';
import ProjectContextMenuV2 from './project-context-menu-v2';
import ProjectCoverV2 from './project-cover-v2';
import ProjectCardV2 from './project-card-v2';
import {normalizeLibraryProjectsV2,normalizePackTracksV2,type LibraryBeatV2,type LibraryPackV2,type LibraryProjectsV2} from './project-read-v2';
import {createProjectShareLinkV2} from './project-requests-v2';
import ProjectActionDialogV2,{type ContextProject,type ProjectAction,type ChangedProject} from './project-action-dialog-v2';
const api=import.meta.env.VITE_API_URL;
type BeatItem = LibraryBeatV2;
type PackItem = LibraryPackV2;
type LibraryData = LibraryProjectsV2;
// Private, per-page waveform cache. Start decoding before playback when possible.
const waveCache=new Map<string,number[]>();
const wavePending=new Map<string,Promise<number[]>>();
function loadWaveform(fileId:number,ownerId:number):Promise<number[]>{
 const key=String(ownerId)+':'+String(fileId);
 const cached=waveCache.get(key);
 if(cached)return Promise.resolve(cached);
 const existing=wavePending.get(key);
 if(existing)return existing;
 const pending=(async()=>{
  let context:AudioContext|null=null;
  try{
   const response=await fetch(api+'/api/public/audio/'+ownerId+'/'+fileId,{credentials:'include'});
   if(!response.ok)throw Error('Waveform unavailable');
   const bytes=await response.arrayBuffer();
   context=new AudioContext();
   const decoded=await context.decodeAudioData(bytes);
   const samples=decoded.getChannelData(0);
   const count=84;
   const size=Math.max(1,Math.floor(samples.length/count));
   const peaks=Array.from({length:count},(_,index)=>{
    let peak=0;
    const end=Math.min(samples.length,(index+1)*size);
    for(let i=index*size;i<end;i+=32)peak=Math.max(peak,Math.abs(samples[i]));
    return peak;
   });
   const max=Math.max(...peaks,.001);
   const bars=peaks.map(value=>value/max);
   if(waveCache.size>=16)waveCache.delete(waveCache.keys().next().value!);
   waveCache.set(key,bars);
   return bars;
  }finally{
   wavePending.delete(key);
   if(context&&context.state!=='closed')await context.close().catch(()=>{});
  }
 })();
 wavePending.set(key,pending);
 return pending;
}
function useWaveform(fileId:number|null,ownerId:number|null){
 const [bars,setBars]=useState<number[]>([]);
 useEffect(()=>{
  let active=true;
  const key=ownerId&&fileId?String(ownerId)+':'+String(fileId):null;
  setBars(key?waveCache.get(key)||[]:[]);
  if(fileId&&ownerId)loadWaveform(fileId,ownerId).then(value=>{if(active)setBars(value)}).catch(()=>{});
  return()=>{active=false};
 },[fileId,ownerId]);
 return bars;
}
export default function LibraryItemsV2({onUpload,onPlayerVisibility,onPlaybackChange,userId,active=true,playRequest}:{onUpload:()=>void;onPlayerVisibility?:(visible:boolean)=>void;onPlaybackChange?:(state:{ownerId:number;kind:'beat'|'pack';id:string;playing:boolean}|null)=>void;userId?:number;active?:boolean;playRequest?:{ownerId:number;kind:'beat'|'pack';id:string;nonce:number}|null}){
 const [data,setData]=useState<LibraryData>({beats:[],packs:[]});
 const [loadedViewerId,setLoadedViewerId]=useState<number|null>(null);
 const [libraryRevision,setLibraryRevision]=useState(0);
 const lastLibraryFetch=useRef(0);
 const wasActive=useRef(active);
 useEffect(()=>subscribeV2DataChanges(['library'],()=>setLibraryRevision(v=>v+1),userId),[userId]);
 useEffect(()=>subscribeV2Resume(()=>{
  if(!active)return;
  if(Date.now()-lastLibraryFetch.current>3000)setLibraryRevision(v=>v+1);
 }),[active,userId]);
 // Opening Library after browsing other screens must revalidate, even when
 // the tab never lost focus. Suppress an extra fetch right after Upload.
 useEffect(()=>{
  if(active&&!wasActive.current){
   if(Date.now()-lastLibraryFetch.current>1500)setLibraryRevision(v=>v+1);
  }
  wasActive.current=active;
 },[active]);
 const [loading,setLoading]=useState(true);
 const [current,setCurrent]=useState<BeatItem|null>(null);
 const [openedPack,setOpenedPack]=useState<PackItem|null>(null);
 const [openedTracks,setOpenedTracks]=useState<BeatItem[]>([]);
 const [packLoading,setPackLoading]=useState(false);
 const [packError,setPackError]=useState('');
 const [openedBeat,setOpenedBeat]=useState<BeatItem|null>(null);
 const [contextBeat,setContextBeat]=useState<{beat:BeatItem;x:number;y:number}|null>(null);
 const [contextPack,setContextPack]=useState<{pack:PackItem;x:number;y:number}|null>(null);
 const [actionDialog,setActionDialog]=useState<{project:ContextProject;action:ProjectAction}|null>(null);
 const showProjectAction=(action:ProjectAction,project:ContextProject)=>{
  setContextBeat(null);setContextPack(null);setActionDialog({action,project});
 };
 const onProjectChanged=(change:ChangedProject)=>{
  const {source,action}=change;
  if(action==='delete'){
   if(source.kind==='beat'){
    setOpenedBeat(previous=>previous?.id===source.id?null:previous);
    setOpenedTracks(previous=>previous.filter(item=>item.id!==source.id));
    setQueue(previous=>previous.filter(item=>!(item.id===source.id&&item.owner_id===userId)));
    if(current?.id===source.id&&current?.owner_id===userId){
     audioRef.current?.pause();setCurrent(null);setPlaying(false);setDuration(0);setElapsed(0);
    }
   }else{
    setOpenedPack(previous=>previous?.id===source.id?null:previous);
    if(activePackId===source.id)setActivePackId(null);
   }
  }else if(action==='rename'){
   if(source.kind==='beat'){
    setCurrent(previous=>previous?.id===source.id&&previous.owner_id===userId?{...previous,title:change.title!}:previous);
    setQueue(previous=>previous.map(item=>item.id===source.id&&item.owner_id===userId?{...item,title:change.title!}:item));
    setOpenedBeat(previous=>previous?.id===source.id?{...previous,title:change.title!}:previous);
    setOpenedTracks(previous=>previous.map(item=>item.id===source.id?{...item,title:change.title!}:item));
   }else{
    setOpenedPack(previous=>previous?.id===source.id?{...previous,title:change.title!}:previous);
   }
  }else if(action==='cover'){
   if(source.kind==='beat'){
    setCurrent(previous=>previous?.id===source.id&&previous.owner_id===userId?{...previous,cover_file_id:change.coverFileId!}:previous);
    setQueue(previous=>previous.map(item=>item.id===source.id&&item.owner_id===userId?{...item,cover_file_id:change.coverFileId!}:item));
    setOpenedBeat(previous=>previous?.id===source.id?{...previous,cover_file_id:change.coverFileId!}:previous);
    setOpenedTracks(previous=>previous.map(item=>item.id===source.id?{...item,cover_file_id:change.coverFileId!}:item));
   }else{
    setOpenedPack(previous=>previous?.id===source.id?{...previous,cover_file_id:change.coverFileId!}:previous);
   }
  }
  setActionDialog(null);
 };
 const showBeatMenu=(event:React.MouseEvent,beat:BeatItem)=>{
  event.preventDefault();event.stopPropagation();
  setContextPack(null);
  setContextBeat({beat,x:event.clientX,y:event.clientY});
 };
 const showPackMenu=(event:React.MouseEvent,pack:PackItem)=>{
  event.preventDefault();event.stopPropagation();
  setContextBeat(null);
  setContextPack({pack,x:event.clientX,y:event.clientY});
 };
 useEffect(()=>{
  if(!contextBeat&&!contextPack)return;
  const dismiss=()=>{setContextBeat(null);setContextPack(null)};
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape')dismiss()};
  document.addEventListener('pointerdown',dismiss);
  document.addEventListener('keydown',key);
  window.addEventListener('scroll',dismiss,true);
  window.addEventListener('resize',dismiss);
  return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',key);window.removeEventListener('scroll',dismiss,true);window.removeEventListener('resize',dismiss)};
 },[contextBeat,contextPack]);

 const {published,saved,toggleSaved,togglePublished}=useProjectFlagsV2();
 const savedBeatIds=useMemo(()=>new Set([...saved].filter(key=>key.startsWith(userId+':beat:')).map(key=>key.slice((userId+':beat:').length))),[saved,userId]);
 const savedPackIds=useMemo(()=>new Set([...saved].filter(key=>key.startsWith(userId+':pack:')).map(key=>key.slice((userId+':pack:').length))),[saved,userId]);
 const [actionError,setActionError]=useState('');
 const publicationKey=(kind:'beat'|'pack',id:string)=>kind+':'+id;
 const togglePublish=async(kind:'beat'|'pack',id:string)=>{
  setContextBeat(null);setContextPack(null);setActionError('');
  try{await togglePublished(kind,id)}
  catch(error){setActionError(error instanceof Error?error.message:'Unable to update publication')}
 };
 const copyProjectLink=async(kind:'beat'|'pack',id:string)=>{
  setContextBeat(null);setContextPack(null);setActionError('');
  try{
   const url=await createProjectShareLinkV2(kind,id);
   await navigator.clipboard.writeText(url);
  }catch(e){setActionError(e instanceof Error?e.message:'Unable to copy link')}
 };
 const toggleSavedProject=async(kind:'beat'|'pack',id:string)=>{
  if(!userId){setActionError('Sign in to save public projects');return;}
  setActionError('');
  try{await toggleSaved(userId,kind,id)}
  catch(error){setActionError(error instanceof Error?error.message:'Unable to save')}
 };
 const openPack=async(pack:PackItem)=>{
  setOpenedPack(pack);setOpenedTracks([]);setPackError('');setPackLoading(true);
  try{
   const response=await fetch(api+'/api/library/files/pack-tracks/'+pack.id,{credentials:'include'});
   if(!response.ok)throw Error('Unable to load pack');
   const result=await response.json();
   setOpenedTracks(normalizePackTracksV2(result,pack));
  }catch(e){setPackError(e instanceof Error?e.message:'Unable to load pack')}
  finally{setPackLoading(false)}
 };
 useEffect(()=>{if(!openedBeat)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpenedBeat(null)};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close)},[openedBeat]);

 const waveBars=useWaveform(current?.audio_file_id??null,current?.owner_id??userId??null);
 const [queue,setQueue]=useState<BeatItem[]>([]);
 const [playing,setPlaying]=useState(false);
 const [activePackId,setActivePackId]=useState<string|null>(null);
 const [elapsed,setElapsed]=useState(0);
 const [duration,setDuration]=useState(0);
 const [playerError,setPlayerError]=useState('');
 const [popup,setPopup]=useState<'queue'|'volume'|null>(null);
 const [volume,setVolume]=useState(1);
 const [muted,setMuted]=useState(false);
 const [shuffle,setShuffle]=useState(false);
 const [repeat,setRepeat]=useState<'off'|'all'|'one'>('off');
 const [coverUrl,setCoverUrl]=useState('');
 const [coverLoadedId,setCoverLoadedId]=useState<number|null>(null);
 useEffect(()=>{
  const id=current?.cover_file_id??null;
  setCoverUrl('');
  setCoverLoadedId(null);
  if(!id||!api)return;
  let active=true;
  let objectUrl='';
  fetch(api+'/api/public/cover/'+(current?.owner_id??userId)+'/'+id,{credentials:'include'})
   .then(response=>{if(!response.ok)throw Error('Cover unavailable');return response.blob()})
   .then(blob=>{objectUrl=URL.createObjectURL(blob);if(active){setCoverUrl(objectUrl);setCoverLoadedId(id)}else URL.revokeObjectURL(objectUrl)})
   .catch(()=>{if(active){setCoverUrl('');setCoverLoadedId(null)}});
  return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)};
 },[current?.cover_file_id,current?.owner_id,userId]);
 useEffect(()=>{if(audioRef.current){audioRef.current.volume=volume;audioRef.current.muted=muted}},[volume,muted,current?.id]);
 useEffect(()=>{if(!popup)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setPopup(null)};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key)},[popup]);
 const audioRef=useRef<HTMLAudioElement|null>(null);
 useEffect(()=>{onPlayerVisibility?.(Boolean(current));return ()=>onPlayerVisibility?.(false)},[Boolean(current),onPlayerVisibility]);
 useEffect(()=>{const audio=audioRef.current;if(!audio||!current)return;audio.load();audio.play().then(()=>setPlaying(true)).catch(()=>{setPlaying(false);setPlayerError('Unable to play audio')})},[current?.owner_id,current?.id,current?.audio_file_id]);
 const toggle=()=>{const a=audioRef.current;if(!a)return;if(a.paused)a.play().then(()=>setPlaying(true)).catch(()=>setPlayerError('Unable to play audio'));else{a.pause();setPlaying(false)}};
 const choose=(beat:BeatItem,list:BeatItem[],packId:string|null=null)=>{
  const tracks=list.map(item=>({...item,owner_id:item.owner_id??userId}));
  const selected=tracks.find(item=>item.id===beat.id&&item.owner_id===(beat.owner_id??userId))||{...beat,owner_id:beat.owner_id??userId};
  setPlayerError('');
  if(current?.id===selected.id&&current?.owner_id===selected.owner_id&&activePackId===packId){toggle();return;}
  setActivePackId(packId);setQueue(tracks);setElapsed(0);setDuration(0);setCurrent(selected);
 };
 const addToQueue=(beat:BeatItem)=>{
  if(!current){choose(beat,[beat])}
  else setQueue(previous=>[...previous,{...beat,owner_id:beat.owner_id??userId}]);
  setContextBeat(null);
 };
 const next=()=>{if(!current)return;if(repeat==='one'){if(audioRef.current){audioRef.current.currentTime=0;audioRef.current.play().catch(()=>{})}return;}const index=queue.findIndex(b=>b.id===current.id&&b.owner_id===current.owner_id);const target=shuffle&&queue.length>1?queue.filter(b=>b.id!==current.id||b.owner_id!==current.owner_id)[Math.floor(Math.random()*(queue.length-1))]:queue[index+1]||(repeat==='all'?queue[0]:null);if(target){setCurrent(target);setElapsed(0)}else{setPlaying(false)}};
 const previous=()=>{if(!current)return;const index=queue.findIndex(b=>b.id===current.id&&b.owner_id===current.owner_id);if(index>0){setCurrent(queue[index-1]);setElapsed(0)}else if(audioRef.current)audioRef.current.currentTime=0};
 const playPack=async(p:PackItem)=>{if(activePackId===p.id&&current){toggle();return;}try{setPlayerError('');const response=await fetch(api+'/api/library/files/pack-tracks/'+p.id,{credentials:'include'});if(!response.ok)throw Error('Unable to load pack');const result=await response.json();const beats=normalizePackTracksV2(result,p);if(beats[0])void loadWaveform(beats[0].audio_file_id,userId!).catch(()=>{});if(!beats.length)throw Error('Pack has no playable beats');choose(beats[0],beats,p.id)}catch(e){setPlayerError(e instanceof Error?e.message:'Unable to load pack')}};

 // A Profile/Catalog/Saves play request resolves the original owner's project.
 // The owner-only Library list must never be used for cross-user playback.
 useEffect(()=>{
  if(!playRequest||!api)return;
  const {ownerId,kind,id}=playRequest;
  const sameProject=!!current&&current.owner_id===ownerId&&
   (kind==='pack'?activePackId===id:activePackId===null&&current.id===id);
  if(sameProject){toggle();return;}
  const controller=new AbortController();
  setPlayerError('');
  void (async()=>{
   try{
    const response=await fetch(api+'/api/public/play/'+ownerId+'/'+kind+'/'+id,{credentials:'include',signal:controller.signal});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(result.error||'Project unavailable for playback');
    const project=result.project;
    const tracks=normalizeLibraryProjectsV2({beats:project?.tracks},ownerId).beats.map(beat=>({
     ...beat,cover_file_id:beat.cover_file_id??project.cover_file_id??null
    }));
    if(!tracks.length)throw Error('Project has no playable audio');
    if(!controller.signal.aborted)choose(tracks[0],tracks,kind==='pack'?id:null);
   }catch(error){if(!controller.signal.aborted)setPlayerError(error instanceof Error?error.message:'Unable to play this project');}
  })();
  return()=>controller.abort();
 },[playRequest?.nonce]);
 useEffect(()=>{
  if(!current){onPlaybackChange?.(null);return;}
  onPlaybackChange?.({ownerId:current.owner_id??userId!,kind:activePackId?'pack':'beat',
   id:activePackId||current.id,playing});
 },[current?.owner_id,current?.id,activePackId,playing,onPlaybackChange,userId]);
 const [error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  if(!userId){setData({beats:[],packs:[]});setLoadedViewerId(null);setLoading(false);return;}
  if(!api){setError('Library API is not configured');setLoading(false);return;}
  setError('');setLoading(true);
  lastLibraryFetch.current=Date.now();
  fetch(api+'/api/library/files/items',{credentials:'include',cache:'no-store',signal:controller.signal})
   .then(async r=>{const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||'Unable to load Library');return body})
   .then(body=>{if(!controller.signal.aborted){setData(normalizeLibraryProjectsV2(body,Number(userId)));setLoadedViewerId(Number(userId));}})
   .catch(e=>{if(e.name!=='AbortError')setError(e.message||'Unable to load Library')})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return ()=>controller.abort();
 },[userId,libraryRevision]);
 const visibleData=loadedViewerId===Number(userId)?data:{beats:[],packs:[]};
 const standaloneBeats=visibleData.beats.filter(b=>b.library_visible!==false);
 // Warm the first standalone waveform while the user browses the Library.
 useEffect(()=>{const first=visibleData.beats.find(b=>b.library_visible!==false);if(first&&userId)void loadWaveform(first.audio_file_id,userId).catch(()=>{})},[data.beats,loadedViewerId,userId]);
 const empty=!standaloneBeats.length&&!visibleData.packs.length;
 return <section className={"beat-profile library-page onece-v2-library"+(!active?" onece-library-inactive":"")}><div className="beat-profile-content"><div className="library-items">
  {actionError&&<p role="alert" className="v2-library-status">{actionError}</p>}
  {loading||loadedViewerId!==Number(userId)?<p className="v2-library-status">Loading your Library…</p>:
   error?<div className="v2-library-status" role="alert">{error}<button type="button" onClick={()=>setLibraryRevision(v=>v+1)}>Retry</button></div>:
   empty?<div className="library-empty"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 4v16M9 4v16M14 4l4 16"/></svg><h2>Your Library is Empty</h2><button type="button" className="library-add-audio" onClick={onUpload}>Add Audio</button></div>:
   <div className="v2-library-contents">
    {openedPack?<div className="library-pack-detail v2-pack-detail">
      <button type="button" className="library-pack-back" aria-label="Back to library" onClick={()=>setOpenedPack(null)}><ChevronLeft size={20}/></button>
      <div className="library-pack-cover beat-art-0"><ProjectCoverV2 ownerId={userId} fileId={openedPack.cover_file_id} title={openedPack.title} className="v2-item-cover"/></div>
      <header className="library-pack-info"><div className="library-pack-title-row"><div className="library-pack-title-block"><h2>{openedPack.title}</h2><p>{openedTracks.length} {openedTracks.length===1?'beat':'beats'}</p></div><div className="library-pack-play-controls"><button type="button" className="library-pack-shuffle" aria-label="Shuffle pack" onClick={()=>{if(openedTracks.length){const mixed=[...openedTracks].sort(()=>Math.random()-.5);choose(mixed[0],mixed,openedPack.id)}}}><Shuffle size={19}/></button><button type="button" className="library-pack-play" aria-label={(activePackId===openedPack.id&&playing?'Pause ':'Play ')+openedPack.title} onClick={()=>playPack(openedPack)}>{activePackId===openedPack.id&&playing?<Pause/>:<Play/>}</button></div></div><button type="button" className="library-pack-add" disabled title="Add tracks is not yet available in v2"><span>+</span><span>Add tracks</span></button></header>
      {packLoading?<p className="v2-library-status">Loading beats…</p>:packError?<p role="alert">{packError}</p>:<ol className="beat-track-list">{openedTracks.map((beat,index)=><li key={beat.id} onContextMenu={e=>showBeatMenu(e,beat)} className={current?.id===beat.id?'beat-track-active':''}><button type="button" className="beat-track-play" onClick={()=>choose(beat,openedTracks,openedPack.id)} aria-label={(current?.id===beat.id&&playing?'Pause ':'Play ')+beat.title}><span className="beat-track-number">{current?.id===beat.id&&playing?'▥':index+1}</span><span><strong>{beat.title}</strong></span></button><div className="beat-track-menu"><button type="button" aria-label={'Open '+beat.title} onClick={()=>setOpenedBeat(beat)}>•••</button></div></li>)}</ol>}
     </div>:<div className="beat-pack-grid">
     {visibleData.packs.map((p,index)=><ProjectCardV2 key={'pack-'+p.id} variant="library" project={{...p,kind:'pack'}} ownerId={userId} tone={index%3} secondary={p.track_count+' beats'} playing={activePackId===p.id&&playing}
       onContextMenu={e=>showPackMenu(e,p)} onOpen={()=>openPack(p)} onPlay={()=>playPack(p)}/>)}
     {standaloneBeats.map((b,index)=><ProjectCardV2 key={'beat-'+b.id} variant="library" className="beat-single-card" project={{...b,kind:'beat'}} ownerId={userId} tone={(visibleData.packs.length+index)%3} secondary={b.created_at?new Date(b.created_at).toLocaleDateString('en-US',{month:'short',day:'2-digit'}):'Beat'} playing={current?.id===b.id&&playing}
       onContextMenu={e=>showBeatMenu(e,b)} onOpen={()=>setOpenedBeat(b)} onPlay={()=>choose(b,[b])}
       onPointerEnter={()=>{if(userId)void loadWaveform(b.audio_file_id,userId).catch(()=>{})}}
       onFocusCapture={()=>{if(userId)void loadWaveform(b.audio_file_id,userId).catch(()=>{})}}/>)}
    </div>}
   </div>}
 </div></div>
 {contextPack&&<ProjectContextMenuV2 project={{...contextPack.pack,kind:'pack'}} x={contextPack.x} y={contextPack.y} owner published={published.has(publicationKey('pack',contextPack.pack.id))} saved={savedPackIds.has(contextPack.pack.id)} onPublish={()=>void togglePublish('pack',contextPack.pack.id)} onSave={()=>{const id=contextPack.pack.id;setContextPack(null);void toggleSavedProject('pack',id)}} onShare={()=>void copyProjectLink('pack',contextPack.pack.id)} onQueue={()=>{const pack=contextPack.pack;setContextPack(null);void (async()=>{try{const response=await fetch(api+'/api/library/files/pack-tracks/'+pack.id,{credentials:'include'});if(!response.ok)throw Error('Unable to load pack tracks');const result=await response.json();const tracks=normalizePackTracksV2(result,pack);if(!tracks.length)return;if(!current)choose(tracks[0],tracks,pack.id);else setQueue(previous=>[...previous,...tracks.map(beat=>({...beat,owner_id:userId}))])}catch(error){setPlayerError(error instanceof Error?error.message:'Unable to add pack to queue')}})()}} onAction={action=>showProjectAction(action,{...contextPack.pack,kind:'pack'})}/>}
 {contextBeat&&<ProjectContextMenuV2 project={{...contextBeat.beat,kind:'beat'}} x={contextBeat.x} y={contextBeat.y} owner published={published.has(publicationKey('beat',contextBeat.beat.id))} saved={savedBeatIds.has(contextBeat.beat.id)} onPublish={()=>void togglePublish('beat',contextBeat.beat.id)} onSave={()=>{const id=contextBeat.beat.id;setContextBeat(null);void toggleSavedProject('beat',id)}} onShare={()=>void copyProjectLink('beat',contextBeat.beat.id)} onQueue={()=>addToQueue(contextBeat.beat)} onAction={action=>showProjectAction(action,{...contextBeat.beat,kind:'beat'})}/>}
 {actionDialog&&<ProjectActionDialogV2
  key={actionDialog.action+':'+actionDialog.project.kind+':'+actionDialog.project.id}
  project={actionDialog.project} action={actionDialog.action} packs={visibleData.packs} userId={userId}
  onClose={()=>setActionDialog(null)} onChanged={onProjectChanged}/>}
 {openedBeat&&<div className="beat-player-overlay v2-beat-overlay" role="dialog" aria-modal="true" aria-label={openedBeat.title} onClick={()=>setOpenedBeat(null)}>
  <div className="beat-player-widget v2-beat-widget" onClick={e=>e.stopPropagation()}>
   <button type="button" className={'v2-beat-save'+(savedBeatIds.has(openedBeat.id)?' is-saved':'')} aria-label={savedBeatIds.has(openedBeat.id)?'Unsave beat':'Save beat'} aria-pressed={savedBeatIds.has(openedBeat.id)} onClick={()=>void toggleSavedProject('beat',openedBeat.id)}><Bookmark size={18} fill={savedBeatIds.has(openedBeat.id)?'currentColor':'none'}/></button>
   <button type="button" className="beat-player-close v2-beat-close" aria-label="Close player" onClick={()=>setOpenedBeat(null)}><X size={16} strokeWidth={1.8}/></button>
   <div className="card v2-music-card">
    <div className={'mask'+(playing&&current?.id===openedBeat.id?' is-playing':'')}><div className="spin"><ProjectCoverV2 ownerId={userId} fileId={openedBeat.cover_file_id} title={openedBeat.title} className="v2-item-cover"/></div><div className="hole"><div className="hole-inner"/></div></div>
    <div className="info">
     <div className="track-info"><p className="artist">1CE</p><h2 className="track">{openedBeat.title}</h2></div>
     <div className="bar" role="slider" tabIndex={0} aria-label="Playback position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={current?.id===openedBeat.id&&duration?Math.round(elapsed/duration*100):0} onClick={e=>{if(current?.id!==openedBeat.id){choose(openedBeat,[openedBeat]);return;}const rect=e.currentTarget.getBoundingClientRect();if(audioRef.current&&duration)audioRef.current.currentTime=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))*duration}}><div className="bar-fill" style={{width:(current?.id===openedBeat.id&&duration?elapsed/duration*100:0)+'%'}}/></div>
     <div className="time"><span className="current">{formatTime(current?.id===openedBeat.id?elapsed:0)}</span><span className="total">{formatTime(current?.id===openedBeat.id?duration:0)}</span></div>
     <div className="controls">
      <button type="button" className={'ctrl ctrl-toggle'+(shuffle?' is-active':'')} aria-label="Shuffle" onClick={()=>setShuffle(v=>!v)}><Shuffle size={17}/></button>
      <button type="button" className="ctrl" aria-label="Previous" onClick={previous}><V1SkipBack/></button>
      <button type="button" className="ctrl ctrl-play" aria-label={current?.id===openedBeat.id&&playing?'Pause':'Play'} onClick={()=>{if(current?.id===openedBeat.id)toggle();else choose(openedBeat,[openedBeat])}}>{current?.id===openedBeat.id&&playing?<Pause size={19}/>:<Play size={19}/>}</button>
      <button type="button" className="ctrl" aria-label="Next" onClick={next}><V1SkipForward/></button>
      <button type="button" className={'ctrl ctrl-toggle'+(repeat!=='off'?' is-active':'')} aria-label="Repeat" onClick={()=>setRepeat(v=>v==='off'?'all':v==='all'?'one':'off')}>{repeat==='one'?<Repeat1 size={17}/>:<Repeat size={17}/>}</button>
     </div>
    </div>
   </div>
  </div>
 </div>}
 {current&&<div className="onece-player-dock v2-active-player" aria-label="Audio player">
  <div className="onece-global-player">
   <div className="onece-player-cover" aria-hidden="true">{coverUrl&&coverLoadedId===current.cover_file_id?<img src={coverUrl} alt=""/>:<Music2 size={20}/>}</div>
   <div className="onece-player-meta"><span className="onece-player-title" title={current.title}>{current.title}</span><span className="onece-player-author">1CE</span></div>
   <div className="onece-player-wave" style={{'--played':(duration?elapsed/duration*100:0)+'%'} as React.CSSProperties}>
    <div className={'onece-wave-bars'+(!waveBars.length?' is-loading':'')} aria-hidden="true">{waveBars.map((height,index)=><span key={index} className={index/waveBars.length*100<=(duration?elapsed/duration*100:0)?'is-played':''} style={{height:Math.max(2,height*34)+'px'}}/>)}</div><span className="onece-wave-cursor" aria-hidden="true"/>
    <input type="range" min="0" max={duration||1} step="0.1" value={Math.min(elapsed,duration||1)} disabled={!duration} aria-label="Playback position" onChange={e=>{if(audioRef.current)audioRef.current.currentTime=Number(e.target.value)}}/>
   </div>
   <div className="onece-player-time">{formatTime(elapsed)} <span>/</span> {formatTime(duration)}</div>
   <div className="onece-player-controls">
    <button type="button" className="onece-player-icon" title="Previous" aria-label="Previous" disabled={!current} onClick={previous}><V1SkipBack/></button>
    <button type="button" className="onece-player-icon onece-player-play" title={playing?'Pause':'Play'} aria-label={playing?'Pause':'Play'} onClick={toggle}>{playing?<Pause/>:<Play/>}</button>
    <button type="button" className="onece-player-icon" title="Next" aria-label="Next" disabled={queue.length<2&&repeat!=='all'} onClick={next}><V1SkipForward/></button>
    <button type="button" className={'onece-player-icon'+(shuffle?' is-active':'')} title="Shuffle" aria-label="Shuffle" aria-pressed={shuffle} onClick={()=>setShuffle(v=>!v)}><Shuffle/></button>
    <button type="button" className={'onece-player-icon'+(repeat!=='off'?' is-active':'')} title={'Repeat: '+repeat} aria-label="Repeat" aria-pressed={repeat!=='off'} onClick={()=>setRepeat(v=>v==='off'?'all':v==='all'?'one':'off')}>{repeat==='one'?<Repeat1/>:<Repeat/>}</button>
    <button type="button" className={'onece-player-icon onece-player-queue'+(popup==='queue'?' is-active':'')} title="Playback queue" aria-label="Playback queue" aria-expanded={popup==='queue'} onClick={()=>setPopup(v=>v==='queue'?null:'queue')}><ListMusic/>{queue.length>1&&<span className="onece-queue-count">{queue.length}</span>}</button>
    <div className="onece-player-volume">
     <button type="button" className={'onece-player-icon'+(popup==='volume'?' is-active':'')} title="Volume" aria-label="Volume" aria-expanded={popup==='volume'} onClick={()=>setPopup(v=>v==='volume'?null:'volume')}>{muted||volume===0?<VolumeX/>:<Volume2/>}</button>
     {popup==='volume'&&<div className="onece-volume-popup v2-volume-popup" role="group" aria-label="Volume control"><div className="v2-volume-track"><input type="range" min="0" max="1" step="0.01" value={muted?0:volume} style={{'--volume-level':((muted?0:volume)*100)+'%'} as React.CSSProperties} onChange={e=>{setMuted(false);setVolume(Number(e.target.value))}} aria-label="Volume level" aria-orientation="vertical"/></div></div>}
    </div>
   </div>
  </div>
  {playerError&&<p className="onece-player-error" role="alert">{playerError}</p>}
  {popup==='queue'&&<section className="onece-queue-popup" role="region" aria-label="Playback queue"><header><h2>Playback queue</h2><button type="button" className="onece-player-icon" aria-label="Close queue" onClick={()=>setPopup(null)}><X/></button></header><div className="onece-queue-current"><small>Now playing</small><p>{current.title}</p></div><ol>{queue.map((beat,index)=><li key={beat.id}><button type="button" className="onece-queue-track" onClick={()=>{setCurrent(beat);setPopup(null)}}><span>{String(index+1).padStart(2,'0')}</span><span>{beat.title}</span></button></li>)}</ol></section>}
 </div>}
 {playerError&&!current&&<p className="v2-player-error v2-player-notice" role="alert">{playerError}</p>}
 {current&&<audio ref={audioRef} crossOrigin="use-credentials" preload="metadata" src={api+'/api/public/audio/'+(current.owner_id??userId)+'/'+current.audio_file_id} onTimeUpdate={e=>setElapsed(e.currentTarget.currentTime)} onLoadedMetadata={e=>setDuration(Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0)} onEnded={next} onPause={()=>setPlaying(false)} onPlay={()=>setPlaying(true)} onError={()=>{setPlaying(false);setPlayerError('Audio could not be loaded')}}/>}
 </section>;
}

function formatTime(n:number){if(!Number.isFinite(n))return '00:00';const t=Math.floor(n);return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0')}


/* Lucide 1.x skip icon paths used by v1, kept local so v2's older Lucide
   dependency does not change unrelated icons. */
function V1SkipBack(){return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z"/><path d="M3 20V4"/></svg>}
function V1SkipForward(){return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 4v16"/><path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/></svg>}
