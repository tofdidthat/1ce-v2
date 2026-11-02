// 1CE v2 private library. Never requests v1 data.
import React,{useEffect,useRef,useState} from 'react';
import {Play,Pause,SkipBack,SkipForward,Shuffle,Repeat,Repeat1,ListMusic,Volume2,VolumeX,X,Music2,ChevronLeft} from 'lucide-react';
import './library-items-v2.css';
const api=import.meta.env.VITE_API_URL;
type BeatItem = {id:string;title:string;audio_file_id:number;cover_file_id:number|null;stems_file_id:number|null;pack_count:number;created_at:string;library_visible:boolean};
type PackItem = {id:string;title:string;cover_file_id:number|null;track_count:number;created_at:string};
type LibraryData = {beats:BeatItem[];packs:PackItem[]};
function Cover({id,title}:{id:number|null;title:string}){
 const [url,setUrl]=useState('');
 useEffect(()=>{
  if(!id||!api)return;
  let active=true;let objectUrl='';
  fetch(api+'/api/library/files/cover/'+id,{credentials:'include'})
   .then(r=>{if(!r.ok)throw Error('Cover unavailable');return r.blob()})
   .then(blob=>{objectUrl=URL.createObjectURL(blob);if(active)setUrl(objectUrl);else URL.revokeObjectURL(objectUrl)})
   .catch(()=>{});
  return ()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)};
 },[id]);
 return <div className="v2-item-cover">{url?<img src={url} alt={title+' cover'}/>:<span>{title.trim().charAt(0).toUpperCase()||'♪'}</span>}</div>;
}
// Private, per-page waveform cache. Start decoding before playback when possible.
const waveCache=new Map<number,number[]>();
const wavePending=new Map<number,Promise<number[]>>();
function loadWaveform(fileId:number):Promise<number[]>{
 const cached=waveCache.get(fileId);
 if(cached)return Promise.resolve(cached);
 const existing=wavePending.get(fileId);
 if(existing)return existing;
 const pending=(async()=>{
  let context:AudioContext|null=null;
  try{
   const response=await fetch(api+'/api/library/files/audio/'+fileId,{credentials:'include'});
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
   waveCache.set(fileId,bars);
   return bars;
  }finally{
   wavePending.delete(fileId);
   if(context&&context.state!=='closed')await context.close().catch(()=>{});
  }
 })();
 wavePending.set(fileId,pending);
 return pending;
}
function useWaveform(fileId:number|null){
 const [bars,setBars]=useState<number[]>([]);
 useEffect(()=>{
  let active=true;
  setBars(fileId?waveCache.get(fileId)||[]:[]);
  if(fileId)loadWaveform(fileId).then(value=>{if(active)setBars(value)}).catch(()=>{});
  return()=>{active=false};
 },[fileId]);
 return bars;
}
export default function LibraryItemsV2({onUpload,onPlayerVisibility}:{onUpload:()=>void;onPlayerVisibility?:(visible:boolean)=>void}){
 const [data,setData]=useState<LibraryData>({beats:[],packs:[]});
 const [loading,setLoading]=useState(true);
 const [current,setCurrent]=useState<BeatItem|null>(null);
 const [openedPack,setOpenedPack]=useState<PackItem|null>(null);
 const [openedTracks,setOpenedTracks]=useState<BeatItem[]>([]);
 const [packLoading,setPackLoading]=useState(false);
 const [packError,setPackError]=useState('');
 const [openedBeat,setOpenedBeat]=useState<BeatItem|null>(null);
 const openPack=async(pack:PackItem)=>{
  setOpenedPack(pack);setOpenedTracks([]);setPackError('');setPackLoading(true);
  try{
   const response=await fetch(api+'/api/library/files/pack-tracks/'+pack.id,{credentials:'include'});
   if(!response.ok)throw Error('Unable to load pack');
   const result=await response.json();
   setOpenedTracks((result.beats as BeatItem[]).map(beat=>({...beat,cover_file_id:beat.cover_file_id??pack.cover_file_id})));
  }catch(e){setPackError(e instanceof Error?e.message:'Unable to load pack')}
  finally{setPackLoading(false)}
 };
 useEffect(()=>{if(!openedBeat)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpenedBeat(null)};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close)},[openedBeat]);

 const waveBars=useWaveform(current?.audio_file_id??null);
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
  fetch(api+'/api/library/files/cover/'+id,{credentials:'include'})
   .then(response=>{if(!response.ok)throw Error('Cover unavailable');return response.blob()})
   .then(blob=>{objectUrl=URL.createObjectURL(blob);if(active){setCoverUrl(objectUrl);setCoverLoadedId(id)}else URL.revokeObjectURL(objectUrl)})
   .catch(()=>{if(active){setCoverUrl('');setCoverLoadedId(null)}});
  return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)};
 },[current?.cover_file_id]);
 useEffect(()=>{if(audioRef.current){audioRef.current.volume=volume;audioRef.current.muted=muted}},[volume,muted,current?.id]);
 useEffect(()=>{if(!popup)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setPopup(null)};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key)},[popup]);
 const audioRef=useRef<HTMLAudioElement|null>(null);
 useEffect(()=>{onPlayerVisibility?.(Boolean(current));return ()=>onPlayerVisibility?.(false)},[Boolean(current),onPlayerVisibility]);
 useEffect(()=>{const audio=audioRef.current;if(!audio||!current)return;audio.load();audio.play().then(()=>setPlaying(true)).catch(()=>{setPlaying(false);setPlayerError('Unable to play audio')})},[current?.id]);
 const toggle=()=>{const a=audioRef.current;if(!a)return;if(a.paused)a.play().then(()=>setPlaying(true)).catch(()=>setPlayerError('Unable to play audio'));else{a.pause();setPlaying(false)}};
 const choose=(beat:BeatItem,list:BeatItem[],packId:string|null=null)=>{setPlayerError('');setActivePackId(packId);setQueue(list);if(current?.id===beat.id){toggle();return;}setElapsed(0);setDuration(0);setCurrent(beat)};
 const next=()=>{if(!current)return;if(repeat==='one'){if(audioRef.current){audioRef.current.currentTime=0;audioRef.current.play().catch(()=>{})}return;}const index=queue.findIndex(b=>b.id===current.id);const target=shuffle&&queue.length>1?queue.filter(b=>b.id!==current.id)[Math.floor(Math.random()*(queue.length-1))]:queue[index+1]||(repeat==='all'?queue[0]:null);if(target){setCurrent(target);setElapsed(0)}else{setPlaying(false)}};
 const previous=()=>{if(!current)return;const index=queue.findIndex(b=>b.id===current.id);if(index>0){setCurrent(queue[index-1]);setElapsed(0)}else if(audioRef.current)audioRef.current.currentTime=0};
 const playPack=async(p:PackItem)=>{if(activePackId===p.id&&current){toggle();return;}try{setPlayerError('');const response=await fetch(api+'/api/library/files/pack-tracks/'+p.id,{credentials:'include'});if(!response.ok)throw Error('Unable to load pack');const result=await response.json();const beats=(result.beats as BeatItem[]).map(beat=>({...beat,cover_file_id:beat.cover_file_id??p.cover_file_id}));if(beats[0])void loadWaveform(beats[0].audio_file_id).catch(()=>{});if(!beats.length)throw Error('Pack has no playable beats');choose(beats[0],beats,p.id)}catch(e){setPlayerError(e instanceof Error?e.message:'Unable to load pack')}};

 const [error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  if(!api){setError('Library API is not configured');setLoading(false);return;}
  fetch(api+'/api/library/files/items',{credentials:'include',signal:controller.signal})
   .then(async r=>{const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||'Unable to load Library');return body})
   .then(body=>setData({beats:body.beats||[],packs:body.packs||[]}))
   .catch(e=>{if(e.name!=='AbortError')setError(e.message||'Unable to load Library')})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return ()=>controller.abort();
 },[]);
 const standaloneBeats=data.beats.filter(b=>b.library_visible!==false);
 // Warm the first standalone waveform while the user browses the Library.
 useEffect(()=>{const first=data.beats.find(b=>b.library_visible!==false);if(first)void loadWaveform(first.audio_file_id).catch(()=>{})},[data.beats]);
 const empty=!standaloneBeats.length&&!data.packs.length;
 return <section className="beat-profile library-page onece-v2-library"><div className="beat-profile-content"><div className="library-items">
  {loading?<p className="v2-library-status">Loading your Library…</p>:
   error?<div className="v2-library-status" role="alert">{error}<button onClick={()=>window.location.reload()}>Retry</button></div>:
   empty?<div className="library-empty"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 4v16M9 4v16M14 4l4 16"/></svg><h2>Your Library is Empty</h2><button type="button" className="library-add-audio" onClick={onUpload}>Add Audio</button></div>:
   <div className="v2-library-contents">
    {openedPack?<div className="library-pack-detail v2-pack-detail">
      <button type="button" className="library-pack-back" aria-label="Back to library" onClick={()=>setOpenedPack(null)}><ChevronLeft size={20}/></button>
      <div className="library-pack-cover beat-art-0"><Cover id={openedPack.cover_file_id} title={openedPack.title}/></div>
      <header className="library-pack-info"><div className="library-pack-title-row"><div className="library-pack-title-block"><h2>{openedPack.title}</h2><p>{openedTracks.length} {openedTracks.length===1?'beat':'beats'}</p></div><div className="library-pack-play-controls"><button type="button" className="library-pack-shuffle" aria-label="Shuffle pack" onClick={()=>{if(openedTracks.length){const mixed=[...openedTracks].sort(()=>Math.random()-.5);choose(mixed[0],mixed,openedPack.id)}}}><Shuffle size={19}/></button><button type="button" className="library-pack-play" aria-label={(activePackId===openedPack.id&&playing?'Pause ':'Play ')+openedPack.title} onClick={()=>playPack(openedPack)}>{activePackId===openedPack.id&&playing?<Pause/>:<Play/>}</button></div></div></header>
      <button type="button" className="library-pack-add" disabled title="Add tracks is not yet available in v2"><span>+</span><span>Add tracks</span></button>
      {packLoading?<p className="v2-library-status">Loading beats…</p>:packError?<p role="alert">{packError}</p>:<ol className="beat-track-list">{openedTracks.map((beat,index)=><li key={beat.id} className={current?.id===beat.id?'beat-track-active':''}><button type="button" className="beat-track-play" onClick={()=>choose(beat,openedTracks,openedPack.id)} aria-label={(current?.id===beat.id&&playing?'Pause ':'Play ')+beat.title}><span className="beat-track-number">{current?.id===beat.id&&playing?'▥':index+1}</span><span><strong>{beat.title}</strong></span></button><div className="beat-track-menu"><button type="button" aria-label={'Open '+beat.title} onClick={()=>setOpenedBeat(beat)}>•••</button></div></li>)}</ol>}
     </div>:<div className="beat-pack-grid">
     {data.packs.map((p,index)=><article key={'pack-'+p.id} className="v2-library-card">
      <div className={'beat-pack-art beat-art-'+index%3+' v2-art-openable'} role="button" tabIndex={0} onClick={()=>openPack(p)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openPack(p)}}} aria-label={'Open pack '+p.title}><Cover id={p.cover_file_id} title={p.title}/><button type="button" className="v2-card-play" aria-label={(activePackId===p.id&&playing?"Pause ":"Play ")+p.title} onClick={e=>{e.stopPropagation();playPack(p)}}>{activePackId===p.id&&playing?<PauseIcon/>:<PlayIcon/>}</button></div>
      <div className="beat-pack-caption"><span className="v2-card-name">{p.title}</span></div>
      <p>{p.track_count} beats</p>
     </article>)}
     {standaloneBeats.map((b,index)=><article key={'beat-'+b.id} className="v2-library-card beat-single-card" onPointerEnter={()=>{void loadWaveform(b.audio_file_id).catch(()=>{})}} onFocusCapture={()=>{void loadWaveform(b.audio_file_id).catch(()=>{})}}>
      <div className={'beat-pack-art beat-art-'+(data.packs.length+index)%3+' v2-art-openable'} role="button" tabIndex={0} onClick={()=>setOpenedBeat(b)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setOpenedBeat(b)}}} aria-label={'Open beat '+b.title}><Cover id={b.cover_file_id} title={b.title}/><button type="button" className="v2-card-play" aria-label={(current?.id===b.id&&playing?"Pause ":"Play ")+b.title} onClick={e=>{e.stopPropagation();choose(b,[b])}}>{current?.id===b.id&&playing?<PauseIcon/>:<PlayIcon/>}</button></div>
      <div className="beat-pack-caption"><span className="v2-card-name">{b.title}</span></div>
      <p>{b.created_at?new Date(b.created_at).toLocaleDateString('en-US',{month:'short',day:'2-digit'}):'Beat'}</p>
     </article>)}
    </div>}
   </div>}
 </div></div>
 {openedBeat&&<div className="beat-player-overlay v2-beat-overlay" role="dialog" aria-modal="true" aria-label={openedBeat.title} onClick={()=>setOpenedBeat(null)}>
  <div className="beat-player-widget v2-beat-widget" onClick={e=>e.stopPropagation()}>
   <button type="button" className="beat-player-close" aria-label="Close player" onClick={()=>setOpenedBeat(null)}>×</button>
   <div className="card v2-music-card">
    <div className={'mask'+(playing&&current?.id===openedBeat.id?' is-playing':'')}><div className="spin"><Cover id={openedBeat.cover_file_id} title={openedBeat.title}/></div><div className="hole"><div className="hole-inner"/></div></div>
    <div className="info">
     <div className="track-info"><p className="artist">1CE</p><h2 className="track">{openedBeat.title}</h2></div>
     <div className="bar" role="slider" tabIndex={0} aria-label="Playback position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={current?.id===openedBeat.id&&duration?Math.round(elapsed/duration*100):0} onClick={e=>{if(current?.id!==openedBeat.id){choose(openedBeat,[openedBeat]);return;}const rect=e.currentTarget.getBoundingClientRect();if(audioRef.current&&duration)audioRef.current.currentTime=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))*duration}}><div className="bar-fill" style={{width:(current?.id===openedBeat.id&&duration?elapsed/duration*100:0)+'%'}}/></div>
     <div className="time"><span className="current">{formatTime(current?.id===openedBeat.id?elapsed:0)}</span><span className="total">{formatTime(current?.id===openedBeat.id?duration:0)}</span></div>
     <div className="controls">
      <button type="button" className={'ctrl ctrl-toggle'+(shuffle?' is-active':'')} aria-label="Shuffle" onClick={()=>setShuffle(v=>!v)}><Shuffle size={15}/></button>
      <button type="button" className="ctrl" aria-label="Previous" onClick={previous}><SkipBack size={17}/></button>
      <button type="button" className="ctrl ctrl-play" aria-label={current?.id===openedBeat.id&&playing?'Pause':'Play'} onClick={()=>choose(openedBeat,[openedBeat])}>{current?.id===openedBeat.id&&playing?<Pause size={16}/>:<Play size={16}/>}</button>
      <button type="button" className="ctrl" aria-label="Next" onClick={next}><SkipForward size={17}/></button>
      <button type="button" className={'ctrl ctrl-toggle'+(repeat!=='off'?' is-active':'')} aria-label="Repeat" onClick={()=>setRepeat(v=>v==='off'?'all':v==='all'?'one':'off')}>{repeat==='one'?<Repeat1 size={15}/>:<Repeat size={15}/>}</button>
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
    <button type="button" className="onece-player-icon" title="Previous" aria-label="Previous" onClick={previous}><SkipBack/></button>
    <button type="button" className="onece-player-icon onece-player-play" title={playing?'Pause':'Play'} aria-label={playing?'Pause':'Play'} onClick={toggle}>{playing?<Pause/>:<Play/>}</button>
    <button type="button" className="onece-player-icon" title="Next" aria-label="Next" disabled={queue.length<2} onClick={next}><SkipForward/></button>
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
 {current&&<audio ref={audioRef} crossOrigin="use-credentials" preload="metadata" src={api+'/api/library/files/audio/'+current.audio_file_id} onTimeUpdate={e=>setElapsed(e.currentTarget.currentTime)} onLoadedMetadata={e=>setDuration(Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0)} onEnded={next} onPause={()=>setPlaying(false)} onPlay={()=>setPlaying(true)} onError={()=>{setPlaying(false);setPlayerError('Audio could not be loaded')}}/>}
 </section>;
}

function PlayIcon(){return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m8 5 12 7-12 7Z"/></svg>}
function PauseIcon(){return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>}
function formatTime(n:number){if(!Number.isFinite(n))return '00:00';const t=Math.floor(n);return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0')}
