// 1CE v2 private library. Never requests v1 data.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Play,Pause,SkipBack,SkipForward,Shuffle,Repeat,Repeat1,ListMusic,Volume2,VolumeX,X,Music2,ChevronLeft,Bookmark,Eye,EyeOff,ListPlus,FolderPlus,Pencil,Image as ImageIcon,Download,Layers,Trash2,ChevronRight,Link2} from 'lucide-react';
import './library-items-v2.css';
import PlayerDockV2 from './player-dock-v2';
import {loadWaveform,useWaveform} from './player-waveform-v2';
import {subscribeV2DataChanges,subscribeV2Resume} from './data-refresh-v2';
import useProjectFlagsV2 from './project-flags-v2';
import ProjectContextMenuV2 from './project-context-menu-v2';
import ProjectCoverV2,{useProjectCoverUrlV2} from './project-cover-v2';
import ProjectCardV2 from './project-card-v2';
import {normalizeLibraryProjectsV2,type LibraryBeatV2,type LibraryPackV2,type LibraryProjectsV2} from './project-read-v2';
import {fetchLibraryHomePayloadV2,fetchLibraryPackTracksV2} from './library-home-api-v2';
import {savedProjectKeyV2} from './project-identity-v2';
import {createProjectShareLinkV2} from './project-requests-v2';
import {fetchPlayableProjectV2} from './public-project-actions-v2';
import {downloadOwnedProjectV2} from './owner-download-v2';
import {appendDistinctQueueV2,upcomingQueueV2,queueTrackKeyV2,tracksFromPlayableProjectV2,type PlaybackQueueTrackV2} from './playback-queue-v2';
import ProjectActionDialogV2,{type ContextProject,type ProjectAction,type ChangedProject} from './project-action-dialog-v2';
const api=import.meta.env.VITE_API_URL;
type BeatItem = LibraryBeatV2;
type PackItem = LibraryPackV2;
type LibraryData = LibraryProjectsV2;
export default function LibraryItemsV2({onUpload,onPlayerVisibility,onPlaybackChange,userId,active=true,playRequest,queueRequest,openRequest,profileRouteKey=null}:{onUpload:()=>void;onPlayerVisibility?:(visible:boolean)=>void;onPlaybackChange?:(state:{ownerId:number;kind:'beat'|'pack';id:string;playing:boolean}|null)=>void;userId?:number;active?:boolean;playRequest?:{ownerId:number;kind:'beat'|'pack';id:string;nonce:number}|null;queueRequest?:{ownerId:number;kind:'beat'|'pack';id:string;nonce:number}|null;openRequest?:{ownerId:number;kind:'beat'|'pack';id:string;nonce:number}|null;profileRouteKey?:string|null}){
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
 const [current,setCurrent]=useState<PlaybackQueueTrackV2|null>(null);
 const currentRef=useRef<PlaybackQueueTrackV2|null>(null);
 currentRef.current=current;
 const [openedPack,setOpenedPack]=useState<PackItem|null>(null);
 const [openedTracks,setOpenedTracks]=useState<BeatItem[]>([]);
 const [packLoading,setPackLoading]=useState(false);
 const [packError,setPackError]=useState('');
 const packRequest=useRef<AbortController|null>(null);
 useEffect(()=>()=>packRequest.current?.abort(),[]);
 const [openedBeat,setOpenedBeat]=useState<BeatItem|null>(null);
 // Home owns one project-detail state, reused for Home, Catalog and Saves.
 const [detailOrigin,setDetailOrigin]=useState<'home'|'profile'|null>(null);
 const detailRequest=useRef<AbortController|null>(null);
 const [detailPending,setDetailPending]=useState(false);
 const [detailError,setDetailError]=useState('');
 const [contextBeat,setContextBeat]=useState<{beat:BeatItem;x:number;y:number}|null>(null);
 const [contextPack,setContextPack]=useState<{pack:PackItem;x:number;y:number}|null>(null);
 const [actionDialog,setActionDialog]=useState<{project:ContextProject;action:ProjectAction}|null>(null);
 // A hidden, persistent Library must not retain another viewer's open metadata panels.
 useEffect(()=>{
  packRequest.current?.abort();
  setOpenedPack(null);setOpenedTracks([]);setOpenedBeat(null);
  setContextBeat(null);setContextPack(null);setActionDialog(null);
  detailRequest.current?.abort();setDetailOrigin(null);setDetailPending(false);setDetailError('');
  // Account switching must clear old private audio and queue state.
  audioRef.current?.pause();setCurrent(null);setQueue([]);setPlaying(false);
  setActivePackId(null);setPopup(null);setPlayerError('');
 },[userId]);
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

 const {published,saved,status:flagsStatus,error:flagsError,refresh:retryFlags,toggleSaved,togglePublished}=useProjectFlagsV2();
 const savedBeatIds=useMemo(()=>new Set([...saved].filter(key=>key.startsWith(userId+':beat:')).map(key=>key.slice((userId+':beat:').length))),[saved,userId]);
 const savedPackIds=useMemo(()=>new Set([...saved].filter(key=>key.startsWith(userId+':pack:')).map(key=>key.slice((userId+':pack:').length))),[saved,userId]);
 const [actionError,setActionError]=useState('');
 const [downloadBusy,setDownloadBusy]=useState(false);
 const downloadAbort=useRef<AbortController|null>(null);
 useEffect(()=>()=>downloadAbort.current?.abort(),[]);
 useEffect(()=>()=>downloadAbort.current?.abort(),[userId]);
 const downloadOwnerProject=async(project:{kind:'beat'|'pack';id:string;title:string})=>{
  if(downloadBusy)return;
  setContextBeat(null);setContextPack(null);setActionError('');setDownloadBusy(true);
  const controller=new AbortController();downloadAbort.current=controller;
  try{await downloadOwnedProjectV2(project,controller.signal)}
  catch(caught){if(!controller.signal.aborted)setActionError(caught instanceof Error?caught.message:'Unable to download project')}
  finally{if(downloadAbort.current===controller){downloadAbort.current=null;setDownloadBusy(false)}};
 };
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
  setDetailOrigin('home');setOpenedBeat(null);setDetailPending(false);setDetailError('');
  packRequest.current?.abort();
  const controller=new AbortController();
  packRequest.current=controller;
  setOpenedPack(pack);setOpenedTracks([]);setPackError('');setPackLoading(true);
  try{
   const tracks=await fetchLibraryPackTracksV2(pack,controller.signal,'Unable to load pack');
   if(!controller.signal.aborted)setOpenedTracks(tracks);
  }catch(e){if(!controller.signal.aborted)setPackError(e instanceof Error?e.message:'Unable to load pack')}
  finally{if(!controller.signal.aborted)setPackLoading(false)}
 };
 useEffect(()=>{if(!openedBeat)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpenedBeat(null)};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close)},[openedBeat]);

 const waveBars=useWaveform(current?.audio_file_id??null,current?.owner_id??userId??null);
 const [queue,setQueue]=useState<PlaybackQueueTrackV2[]>([]);
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
 const coverUrl=useProjectCoverUrlV2(current?.owner_id??userId??null,current?.cover_file_id??null);
 useEffect(()=>{if(audioRef.current){audioRef.current.volume=volume;audioRef.current.muted=muted}},[volume,muted,current?.id]);
 useEffect(()=>{if(!popup)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setPopup(null)};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key)},[popup]);
 const audioRef=useRef<HTMLAudioElement|null>(null);
 useEffect(()=>{onPlayerVisibility?.(Boolean(current));return ()=>onPlayerVisibility?.(false)},[Boolean(current),onPlayerVisibility]);
 useEffect(()=>{const audio=audioRef.current;if(!audio||!current)return;audio.load();audio.play().then(()=>setPlaying(true)).catch(()=>{setPlaying(false);setPlayerError('Unable to play audio')})},[current?.owner_id,current?.id,current?.audio_file_id]);
 const toggle=()=>{const a=audioRef.current;if(!a)return;if(a.paused)a.play().then(()=>setPlaying(true)).catch(()=>setPlayerError('Unable to play audio'));else{a.pause();setPlaying(false)}};
 const choose=(beat:BeatItem,list:BeatItem[],packId:string|null=null)=>{
  const tracks:PlaybackQueueTrackV2[]=list.map(item=>({...item,queue_pack_id:packId}));
  const selected=tracks.find(item=>item.id===beat.id&&item.owner_id===beat.owner_id)||{...beat,queue_pack_id:packId};
  setPlayerError('');
  if(current?.id===selected.id&&current?.owner_id===selected.owner_id&&activePackId===packId){toggle();return;}
  setActivePackId(packId);setQueue(appendDistinctQueueV2([],tracks));setElapsed(0);setDuration(0);setCurrent(selected);
 };
 const addToQueue=(beat:BeatItem)=>{
  if(!current){choose(beat,[beat])}
  else setQueue(previous=>appendDistinctQueueV2(previous,[{...beat,queue_pack_id:null}]));
  setContextBeat(null);
 };
 const next=()=>{if(!current)return;if(repeat==='one'){if(audioRef.current){audioRef.current.currentTime=0;audioRef.current.play().catch(()=>{})}return;}const index=queue.findIndex(b=>b.id===current.id&&b.owner_id===current.owner_id);const target=shuffle&&queue.length>1?queue.filter(b=>b.id!==current.id||b.owner_id!==current.owner_id)[Math.floor(Math.random()*(queue.length-1))]:queue[index+1]||(repeat==='all'?queue[0]:null);if(target){setCurrent(target);setActivePackId(target.queue_pack_id??null);setElapsed(0)}else{setPlaying(false)}};
 const previous=()=>{if(!current)return;const index=queue.findIndex(b=>b.id===current.id&&b.owner_id===current.owner_id);if(index>0){setCurrent(queue[index-1]);setActivePackId(queue[index-1].queue_pack_id??null);setElapsed(0)}else if(audioRef.current)audioRef.current.currentTime=0};
 const playPack=async(p:PackItem)=>{if(activePackId===p.id&&current?.owner_id===p.owner_id){toggle();return;}try{setPlayerError('');const project=await fetchPlayableProjectV2(p.owner_id,'pack',p.id);const beats=tracksFromPlayableProjectV2(project);if(!beats.length)throw Error('Pack has no playable beats');choose(beats[0],beats,p.id)}catch(e){setPlayerError(e instanceof Error?e.message:'Unable to load pack')}};

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
    // Home and Profile share the validated, server-authorized playback manifest.
    const project=await fetchPlayableProjectV2(ownerId,kind,id,controller.signal);
    const tracks=tracksFromPlayableProjectV2(project);
    if(!tracks.length)throw Error('Project has no playable audio');
    if(!controller.signal.aborted)choose(tracks[0],tracks,kind==='pack'?id:null);
   }catch(error){if(!controller.signal.aborted)setPlayerError(error instanceof Error?error.message:'Unable to play this project');}
  })();
  return()=>controller.abort();
 },[playRequest?.nonce]);
 // Queue-only requests never replace the playing track. Playback manifests
 // remain server-authorized; packs append their member beats in original order.
 useEffect(()=>{
  if(!queueRequest)return;
  const controller=new AbortController();
  const {ownerId,kind,id}=queueRequest;
  setPlayerError('');
  void (async()=>{
   try{
    const project=await fetchPlayableProjectV2(ownerId,kind,id,controller.signal);
    const tracks=tracksFromPlayableProjectV2(project).map(beat=>({...beat,queue_pack_id:kind==='pack'?id:null}));
    if(!tracks.length)throw Error('No playable tracks to queue');
    if(controller.signal.aborted)return;
    if(!currentRef.current){choose(tracks[0],tracks,kind==='pack'?id:null);}
    else setQueue(previous=>appendDistinctQueueV2(previous,tracks));
   }catch(error){
    if(!controller.signal.aborted)setPlayerError(error instanceof Error?error.message:'Unable to add to queue');
   }
  })();
  return()=>controller.abort();
 },[queueRequest?.nonce]);
 // Opening a profile card resolves the original project under API authorization.
 useEffect(()=>{
  if(!openRequest||profileRouteKey===null)return;
  const {ownerId,kind,id}=openRequest,controller=new AbortController();
  detailRequest.current?.abort();detailRequest.current=controller;
  packRequest.current?.abort();setContextBeat(null);setContextPack(null);
  setOpenedBeat(null);setOpenedPack(null);setOpenedTracks([]);
  setDetailOrigin('profile');setDetailPending(true);setDetailError('');
  void (async()=>{
   try{
    const project=await fetchPlayableProjectV2(ownerId,kind,id,controller.signal);
    const tracks=tracksFromPlayableProjectV2(project);
    if(controller.signal.aborted)return;
    if(kind==='beat'){
     if(tracks.length!==1)throw Error('Invalid beat detail');
     setOpenedBeat(tracks[0]);
    }else{
     setOpenedPack({ownerId,projectId:id,kind:'pack',id,owner_id:ownerId,title:project.title,
      cover_file_id:project.cover_file_id,track_count:tracks.length,created_at:''});
     setOpenedTracks(tracks);
    }
   }catch(error){
    if(!controller.signal.aborted)setDetailError(error instanceof Error?error.message:'Unable to open project');
   }finally{if(!controller.signal.aborted)setDetailPending(false);}
  })();
  return()=>controller.abort();
 },[openRequest?.nonce]);
 useEffect(()=>{
  // Route/profile changes close stale details; they never reset the global player.
  detailRequest.current?.abort();packRequest.current?.abort();
  setOpenedBeat(null);setOpenedPack(null);setOpenedTracks([]);
  setDetailOrigin(null);setDetailPending(false);setDetailError('');
 },[profileRouteKey]);
 useEffect(()=>{
  if(!current){onPlaybackChange?.(null);return;}
  onPlaybackChange?.({ownerId:current.owner_id??userId!,kind:activePackId?'pack':'beat',
   id:activePackId||current.id,playing});
 },[current?.owner_id,current?.id,activePackId,playing,onPlaybackChange,userId]);
 const [error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  if(!userId){setData({beats:[],packs:[]});setLoadedViewerId(null);setLoading(false);return;}
  if(!api){setError('Home is unavailable');setLoading(false);return;}
  setError('');setLoading(true);
  lastLibraryFetch.current=Date.now();
  fetchLibraryHomePayloadV2(controller.signal)
   .then(({ok,status,body})=>{
    if(!ok){
     // Expired/revoked session cannot keep displaying old private Home metadata.
     if(!controller.signal.aborted&&(status===401||status===403)){
      setData({beats:[],packs:[]});setLoadedViewerId(null);
     }
     throw Error(body.error||'Unable to load Home');
    }
    return body;
   })
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
 const closeProjectDetails=()=>{
  detailRequest.current?.abort();packRequest.current?.abort();
  setOpenedBeat(null);setOpenedPack(null);setOpenedTracks([]);
  setDetailOrigin(null);setDetailPending(false);setDetailError('');
 };
 const packDetail=openedPack?<div className="library-pack-detail v2-pack-detail">
      <button type="button" className="library-pack-back" aria-label={detailOrigin==='profile'?'Back to Profile':'Back to Home'} onClick={closeProjectDetails}><ChevronLeft size={20}/></button>
      <div className="library-pack-cover beat-art-0"><ProjectCoverV2 ownerId={openedPack.owner_id} fileId={openedPack.cover_file_id} title={openedPack.title} className="v2-item-cover"/></div>
      <header className="library-pack-info"><div className="library-pack-title-row"><div className="library-pack-title-block"><h2>{openedPack.title}</h2><p>{openedTracks.length} {openedTracks.length===1?'beat':'beats'}</p></div><div className="library-pack-play-controls"><button type="button" className="library-pack-shuffle" aria-label="Shuffle pack" onClick={()=>{if(openedTracks.length){const mixed=[...openedTracks].sort(()=>Math.random()-.5);choose(mixed[0],mixed,openedPack.id)}}}><Shuffle size={19}/></button><button type="button" className="library-pack-play" aria-label={(activePackId===openedPack.id&&playing?'Pause ':'Play ')+openedPack.title} onClick={()=>playPack(openedPack)}>{activePackId===openedPack.id&&playing?<Pause/>:<Play/>}</button></div></div><button type="button" className="library-pack-add" disabled title="Add tracks is not yet available in v2"><span>+</span><span>Add tracks</span></button></header>
      {packLoading?<p className="v2-library-status">Loading beats…</p>:packError?<p role="alert">{packError}</p>:<ol className="beat-track-list">{openedTracks.map((beat,index)=><li key={beat.id} onContextMenu={e=>{if(beat.owner_id===userId)showBeatMenu(e,beat)}} className={current?.id===beat.id&&current?.owner_id===beat.owner_id?'beat-track-active':''}><button type="button" className="beat-track-play" onClick={()=>choose(beat,openedTracks,openedPack.id)} aria-label={(current?.id===beat.id&&playing?'Pause ':'Play ')+beat.title}><span className="beat-track-number">{current?.id===beat.id&&playing?'▥':index+1}</span><span><strong>{beat.title}</strong></span></button><div className="beat-track-menu"><button type="button" aria-label={'Open '+beat.title} onClick={()=>setOpenedBeat(beat)}>•••</button></div></li>)}</ol>}
     </div>:null;

 return <section className={"beat-profile library-page onece-v2-library"+(!active?" onece-library-inactive":"")}><div className="beat-profile-content"><div className="library-items">
  {actionError&&<p role="alert" className="v2-library-status">{actionError}</p>}
  {flagsStatus==='loading'&&active&&<p className="v2-library-status">Loading Save and Publish actions…</p>}
  {flagsStatus==='error'&&active&&<div className="v2-library-status" role="alert">{flagsError}<button type="button" onClick={retryFlags}>Retry</button></div>}
  {error&&<div className="v2-library-status" role="alert">{error}<button type="button" onClick={()=>setLibraryRevision(v=>v+1)}>Retry</button></div>}
  {loadedViewerId!==Number(userId)?(loading||!error?<p className="v2-library-status">Loading your Home…</p>:null):
   empty?<div className="library-empty"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 4v16M9 4v16M14 4l4 16"/></svg><h2>Your Home is empty</h2><button type="button" className="library-add-audio" onClick={onUpload}>Add Audio</button></div>:
   <div className="v2-library-contents">
    {openedPack&&detailOrigin!=='profile'?packDetail:<div className="beat-pack-grid">
     {visibleData.packs.map((p,index)=><ProjectCardV2 key={'pack-'+p.id} variant="library" project={{...p,kind:'pack'}} ownerId={userId} tone={index%3} secondary={p.track_count+' beats'} playing={activePackId===p.id&&playing}
       onContextMenu={e=>showPackMenu(e,p)} onOpen={()=>openPack(p)} onPlay={()=>playPack(p)}/>)}
     {standaloneBeats.map((b,index)=><ProjectCardV2 key={'beat-'+b.id} variant="library" className="beat-single-card" project={{...b,kind:'beat'}} ownerId={userId} tone={(visibleData.packs.length+index)%3} secondary={b.created_at?new Date(b.created_at).toLocaleDateString('en-US',{month:'short',day:'2-digit'}):'Beat'} playing={current?.id===b.id&&playing}
       onContextMenu={e=>showBeatMenu(e,b)} onOpen={()=>{setDetailOrigin('home');setOpenedPack(null);setOpenedBeat(b)}} onPlay={()=>choose(b,[b])}
       onPointerEnter={()=>{if(userId)void loadWaveform(b.audio_file_id,userId).catch(()=>{})}}
       onFocusCapture={()=>{if(userId)void loadWaveform(b.audio_file_id,userId).catch(()=>{})}}/>)}
    </div>}
   </div>}
 </div></div>
 {detailOrigin==='profile'&&(detailPending||detailError)&&createPortal(
  <div className="v2-profile-project-detail-overlay" role="dialog" aria-modal="true" aria-label="Open project">
   <div className="v2-profile-project-detail-sheet">
    <button type="button" className="library-pack-back" aria-label="Back to Profile" onClick={closeProjectDetails}><ChevronLeft size={20}/></button>
    {detailPending?<p role="status">Loading project…</p>:<p role="alert">{detailError}</p>}
   </div>
  </div>,document.body)}
 {detailOrigin==='profile'&&openedPack&&profileRouteKey!==null&&createPortal(
  <div className="v2-profile-project-detail-overlay" role="dialog" aria-modal="true" aria-label={'Open pack '+openedPack.title}
    onMouseDown={event=>{if(event.target===event.currentTarget)closeProjectDetails()}}>
   <section className="beat-profile library-page onece-v2-library v2-profile-project-detail-sheet">{packDetail}</section>
  </div>,document.body)}
 {contextPack&&<ProjectContextMenuV2 project={{...contextPack.pack,kind:'pack'}} x={contextPack.x} y={contextPack.y} owner published={published.has(publicationKey('pack',contextPack.pack.id))} saved={savedPackIds.has(contextPack.pack.id)} onPublish={flagsStatus==='ready'?()=>void togglePublish('pack',contextPack.pack.id):undefined} onSave={flagsStatus==='ready'?()=>{const id=contextPack.pack.id;setContextPack(null);void toggleSavedProject('pack',id)}:undefined} onShare={()=>void copyProjectLink('pack',contextPack.pack.id)} onQueue={()=>{const pack=contextPack.pack;setContextPack(null);void (async()=>{try{const tracks=await fetchLibraryPackTracksV2(pack,undefined,'Unable to load pack tracks');if(!tracks.length)return;if(!current)choose(tracks[0],tracks,pack.id);else setQueue(previous=>appendDistinctQueueV2(previous,tracks.map(beat=>({...beat,queue_pack_id:pack.id}))))}catch(error){setPlayerError(error instanceof Error?error.message:'Unable to add pack to queue')}})()}} onDownload={downloadBusy?undefined:()=>void downloadOwnerProject({kind:'pack',id:contextPack.pack.id,title:contextPack.pack.title})} onAction={action=>showProjectAction(action,{...contextPack.pack,kind:'pack'})}/>}
 {contextBeat&&<ProjectContextMenuV2 project={{...contextBeat.beat,kind:'beat'}} x={contextBeat.x} y={contextBeat.y} owner published={published.has(publicationKey('beat',contextBeat.beat.id))} saved={savedBeatIds.has(contextBeat.beat.id)} onPublish={flagsStatus==='ready'?()=>void togglePublish('beat',contextBeat.beat.id):undefined} onSave={flagsStatus==='ready'?()=>{const id=contextBeat.beat.id;setContextBeat(null);void toggleSavedProject('beat',id)}:undefined} onShare={()=>void copyProjectLink('beat',contextBeat.beat.id)} onQueue={()=>addToQueue(contextBeat.beat)} onDownload={downloadBusy?undefined:()=>void downloadOwnerProject({kind:'beat',id:contextBeat.beat.id,title:contextBeat.beat.title})} onAction={action=>showProjectAction(action,{...contextBeat.beat,kind:'beat'})}/>}
 {actionDialog&&<ProjectActionDialogV2
  key={actionDialog.action+':'+actionDialog.project.kind+':'+actionDialog.project.id}
  project={actionDialog.project} action={actionDialog.action} packs={visibleData.packs} userId={userId}
  onClose={()=>setActionDialog(null)} onChanged={onProjectChanged}/>}
 {openedBeat&&createPortal(<div className="beat-player-overlay v2-beat-overlay" role="dialog" aria-modal="true" aria-label={openedBeat.title} onClick={()=>setOpenedBeat(null)}>
  <div className="beat-player-widget v2-beat-widget" onClick={e=>e.stopPropagation()}>
   <button type="button" className={'v2-beat-save'+(saved.has(savedProjectKeyV2(openedBeat.owner_id,'beat',openedBeat.id))?' is-saved':'')} aria-label={saved.has(savedProjectKeyV2(openedBeat.owner_id,'beat',openedBeat.id))?'Unsave beat':'Save beat'} aria-pressed={saved.has(savedProjectKeyV2(openedBeat.owner_id,'beat',openedBeat.id))} disabled={flagsStatus!=='ready'} onClick={()=>void toggleSaved(openedBeat.owner_id,'beat',openedBeat.id).catch(error=>setPlayerError(error instanceof Error?error.message:'Unable to save project'))}><Bookmark size={18} fill={saved.has(savedProjectKeyV2(openedBeat.owner_id,'beat',openedBeat.id))?'currentColor':'none'}/></button>
   <button type="button" className="beat-player-close v2-beat-close" aria-label="Close player" onClick={()=>setOpenedBeat(null)}><X size={16} strokeWidth={1.8}/></button>
   <div className="card v2-music-card">
    <div className={'mask'+(playing&&current?.id===openedBeat.id?' is-playing':'')}><div className="spin"><ProjectCoverV2 ownerId={openedBeat.owner_id} fileId={openedBeat.cover_file_id} title={openedBeat.title} className="v2-item-cover"/></div><div className="hole"><div className="hole-inner"/></div></div>
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
 </div>,document.body)}
 {current&&createPortal(<div className="onece-player-dock v2-active-player" aria-label="Audio player">
  <PlayerDockV2 current coverUrl waveBars elapsed duration playing queue repeat shuffle popup muted volume playerError audioRef previous toggle next setShuffle setRepeat setPopup setMuted setVolume setCurrent setActivePackId setElapsed formatTime SkipBackIcon={V1SkipBack} SkipForwardIcon={V1SkipForward}/>
 </div>,document.body)}
 {playerError&&!current&&createPortal(<p className="v2-player-error v2-player-notice" role="alert">{playerError}</p>,document.body)}
 {current&&createPortal(<audio ref={audioRef} crossOrigin="use-credentials" preload="metadata" src={api+'/api/public/audio/'+(current.owner_id??userId)+'/'+current.audio_file_id} onTimeUpdate={e=>setElapsed(e.currentTarget.currentTime)} onLoadedMetadata={e=>setDuration(Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0)} onEnded={next} onPause={()=>setPlaying(false)} onPlay={()=>setPlaying(true)} onError={()=>{setPlaying(false);setPlayerError('Audio could not be loaded')}}/>,document.body)}
 </section>;
}

function formatTime(n:number){if(!Number.isFinite(n))return '00:00';const t=Math.floor(n);return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0')}


/* Lucide 1.x skip icon paths used by v1, kept local so v2's older Lucide
   dependency does not change unrelated icons. */
function V1SkipBack(){return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z"/><path d="M3 20V4"/></svg>}
function V1SkipForward(){return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 4v16"/><path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/></svg>}
