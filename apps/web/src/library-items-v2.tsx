// 1CE v2 private library. Never requests v1 data.
import React,{useEffect,useRef,useState} from 'react';
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
export default function LibraryItemsV2({onUpload,onPlayerVisibility}:{onUpload:()=>void;onPlayerVisibility?:(visible:boolean)=>void}){
 const [data,setData]=useState<LibraryData>({beats:[],packs:[]});
 const [loading,setLoading]=useState(true);
 const [current,setCurrent]=useState<BeatItem|null>(null);
 const [queue,setQueue]=useState<BeatItem[]>([]);
 const [playing,setPlaying]=useState(false);
 const [elapsed,setElapsed]=useState(0);
 const [duration,setDuration]=useState(0);
 const [playerError,setPlayerError]=useState('');
 const audioRef=useRef<HTMLAudioElement|null>(null);
 useEffect(()=>{onPlayerVisibility?.(Boolean(current));return ()=>onPlayerVisibility?.(false)},[Boolean(current),onPlayerVisibility]);
 useEffect(()=>{const audio=audioRef.current;if(!audio||!current)return;audio.load();audio.play().then(()=>setPlaying(true)).catch(()=>{setPlaying(false);setPlayerError('Unable to play audio')})},[current?.id]);
 const toggle=()=>{const a=audioRef.current;if(!a)return;if(a.paused)a.play().then(()=>setPlaying(true)).catch(()=>setPlayerError('Unable to play audio'));else{a.pause();setPlaying(false)}};
 const choose=(beat:BeatItem,list:BeatItem[])=>{setPlayerError('');setQueue(list);if(current?.id===beat.id){toggle();return;}setElapsed(0);setDuration(0);setCurrent(beat)};
 const next=()=>{if(!current)return;const index=queue.findIndex(b=>b.id===current.id);if(index>=0&&index<queue.length-1){setCurrent(queue[index+1]);setElapsed(0)}else{setPlaying(false)}};
 const previous=()=>{if(!current)return;const index=queue.findIndex(b=>b.id===current.id);if(index>0){setCurrent(queue[index-1]);setElapsed(0)}else if(audioRef.current)audioRef.current.currentTime=0};
 const playPack=async(p:PackItem)=>{try{setPlayerError('');const response=await fetch(api+'/api/library/files/pack-tracks/'+p.id,{credentials:'include'});if(!response.ok)throw Error('Unable to load pack');const result=await response.json();const beats=result.beats as BeatItem[];if(!beats.length)throw Error('Pack has no playable beats');choose(beats[0],beats)}catch(e){setPlayerError(e instanceof Error?e.message:'Unable to load pack')}};

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
 const empty=!standaloneBeats.length&&!data.packs.length;
 return <section className="beat-profile library-page onece-v2-library"><div className="beat-profile-content"><div className="library-items">
  {loading?<p className="v2-library-status">Loading your Library…</p>:
   error?<div className="v2-library-status" role="alert">{error}<button onClick={()=>window.location.reload()}>Retry</button></div>:
   empty?<div className="library-empty"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 4v16M9 4v16M14 4l4 16"/></svg><h2>Your Library is Empty</h2><button type="button" className="library-add-audio" onClick={onUpload}>Add Audio</button></div>:
   <div className="v2-library-contents">
    <div className="beat-pack-grid">
     {data.packs.map((p,index)=><article key={'pack-'+p.id} className="v2-library-card">
      <div className={'beat-pack-art beat-art-'+index%3} aria-label={'Pack '+p.title}><Cover id={p.cover_file_id} title={p.title}/></div>
      <div className="beat-pack-caption"><span className="v2-card-name">{p.title}</span><button type="button" className="v2-card-play" aria-label={"Play "+p.title} onClick={()=>playPack(p)}><PlayIcon/></button></div>
      <p>{p.track_count} beats</p>
     </article>)}
     {standaloneBeats.map((b,index)=><article key={'beat-'+b.id} className="v2-library-card beat-single-card">
      <div className={'beat-pack-art beat-art-'+(data.packs.length+index)%3} aria-label={'Beat '+b.title}><Cover id={b.cover_file_id} title={b.title}/></div>
      <div className="beat-pack-caption"><span className="v2-card-name">{b.title}</span><button type="button" className="v2-card-play" aria-label={(current?.id===b.id&&playing?"Pause ":"Play ")+b.title} onClick={()=>choose(b,[b])}>{current?.id===b.id&&playing?<PauseIcon/>:<PlayIcon/>}</button></div>
      <p>{b.created_at?new Date(b.created_at).toLocaleDateString('en-US',{month:'short',day:'2-digit'}):'Beat'}</p>
     </article>)}
    </div>
   </div>}
 </div></div>
 {current&&<div className="onece-player-dock v2-active-player" aria-label="Audio player">
  <div className="onece-global-player v2-player-inner">
   <div className="v2-player-info"><strong>{current.title}</strong><small>{queue.length>1?(queue.findIndex(b=>b.id===current.id)+1)+' / '+queue.length+' beats':'Library'}</small></div>
   <div className="v2-player-controls"><button type="button" onClick={previous} aria-label="Previous track">‹</button><button type="button" onClick={toggle} aria-label={playing?'Pause':'Play'}>{playing?<PauseIcon/>:<PlayIcon/>}</button><button type="button" onClick={next} aria-label="Next track">›</button></div>
   <span className="v2-player-time">{formatTime(elapsed)}</span>
   <input className="v2-player-progress" type="range" min="0" max={duration||1} step="0.1" value={Math.min(elapsed,duration||1)} aria-label="Seek" onChange={e=>{if(audioRef.current)audioRef.current.currentTime=Number(e.target.value)}}/>
   <span className="v2-player-time">{formatTime(duration)}</span>
   <button type="button" className="v2-player-close" aria-label="Close player" onClick={()=>{audioRef.current?.pause();setCurrent(null);setPlaying(false)}}>×</button>
  </div>
  {playerError&&<p className="v2-player-error" role="alert">{playerError}</p>}
 </div>}
 {playerError&&!current&&<p className="v2-player-error v2-player-notice" role="alert">{playerError}</p>}
 {current&&<audio ref={audioRef} crossOrigin="use-credentials" preload="metadata" src={api+'/api/library/files/audio/'+current.audio_file_id} onTimeUpdate={e=>setElapsed(e.currentTarget.currentTime)} onLoadedMetadata={e=>setDuration(Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0)} onEnded={next} onPause={()=>setPlaying(false)} onPlay={()=>setPlaying(true)} onError={()=>{setPlaying(false);setPlayerError('Audio could not be loaded')}}/>}
 </section>;
}

function PlayIcon(){return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m8 5 12 7-12 7Z"/></svg>}
function PauseIcon(){return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>}
function formatTime(n:number){if(!Number.isFinite(n))return '0:00';const t=Math.floor(n);return Math.floor(t/60)+':'+String(t%60).padStart(2,'0')}
