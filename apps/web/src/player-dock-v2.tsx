// Visual-only audio dock. No hooks, no Audio elements, no API requests.
// LibraryItemsV2 remains the sole owner of playback, queue and audio lifecycle.
// Keep DOM/classes unchanged so Home, Catalog and Saves show one player.
import React from 'react';
import {Play,Pause,Shuffle,Repeat,Repeat1,ListMusic,Volume2,VolumeX,X,Music2} from 'lucide-react';
import {upcomingQueueV2,queueTrackKeyV2,type PlaybackQueueTrackV2} from './playback-queue-v2';

type RepeatMode='off'|'all'|'one';
type PopupMode='queue'|'volume'|null;
type Props={
 current:PlaybackQueueTrackV2;
 coverUrl:string;
 waveBars:number[];
 elapsed:number;
 duration:number;
 playing:boolean;
 queue:PlaybackQueueTrackV2[];
 repeat:RepeatMode;
 shuffle:boolean;
 popup:PopupMode;
 muted:boolean;
 volume:number;
 playerError:string;
 audioRef:React.RefObject<HTMLAudioElement|null>;
 previous:()=>void;
 toggle:()=>void;
 next:()=>void;
 setShuffle:React.Dispatch<React.SetStateAction<boolean>>;
 setRepeat:React.Dispatch<React.SetStateAction<RepeatMode>>;
 setPopup:React.Dispatch<React.SetStateAction<PopupMode>>;
 setMuted:React.Dispatch<React.SetStateAction<boolean>>;
 setVolume:React.Dispatch<React.SetStateAction<number>>;
 setCurrent:React.Dispatch<React.SetStateAction<PlaybackQueueTrackV2|null>>;
 setActivePackId:React.Dispatch<React.SetStateAction<string|null>>;
 setElapsed:React.Dispatch<React.SetStateAction<number>>;
 formatTime:(seconds:number)=>string;
 SkipBackIcon:React.ComponentType;
 SkipForwardIcon:React.ComponentType;
};

export default function PlayerDockV2({current,coverUrl,waveBars,elapsed,duration,playing,queue,repeat,shuffle,popup,muted,volume,playerError,audioRef,previous,toggle,next,setShuffle,setRepeat,setPopup,setMuted,setVolume,setCurrent,setActivePackId,setElapsed,formatTime,SkipBackIcon,SkipForwardIcon}:Props){
 return <>
  <div className="onece-global-player">
   <div className="onece-player-cover" aria-hidden="true">{coverUrl?<img src={coverUrl} alt=""/>:<Music2 size={20}/>}</div>
   <div className="onece-player-meta"><span className="onece-player-title" title={current.title}>{current.title}</span><span className="onece-player-author">1CE</span></div>
   <div className="onece-player-wave" style={{'--played':(duration?elapsed/duration*100:0)+'%'} as React.CSSProperties}>
    <div className={'onece-wave-bars'+(!waveBars.length?' is-loading':'')} aria-hidden="true">{waveBars.map((height,index)=><span key={index} className={index/waveBars.length*100<=(duration?elapsed/duration*100:0)?'is-played':''} style={{height:Math.max(2,height*34)+'px'}}/>)}</div><span className="onece-wave-cursor" aria-hidden="true"/>
    <input type="range" min="0" max={duration||1} step="0.1" value={Math.min(elapsed,duration||1)} disabled={!duration} aria-label="Playback position" onChange={e=>{if(audioRef.current)audioRef.current.currentTime=Number(e.target.value)}}/>
   </div>
   <div className="onece-player-time">{formatTime(elapsed)} <span>/</span> {formatTime(duration)}</div>
   <div className="onece-player-controls">
    <div className="onece-player-transport" role="group" aria-label="Transport controls">
    <button type="button" className="onece-player-icon" title="Previous" aria-label="Previous" disabled={!current} onClick={previous}><SkipBackIcon/></button>
    <button type="button" className="onece-player-icon onece-player-play" title={playing?'Pause':'Play'} aria-label={playing?'Pause':'Play'} onClick={toggle}>{playing?<Pause/>:<Play/>}</button>
    <button type="button" className="onece-player-icon" title="Next" aria-label="Next" disabled={queue.length<2&&repeat!=='all'} onClick={next}><SkipForwardIcon/></button>
    </div>
    <div className="onece-player-options" role="group" aria-label="Playback options">
    <button type="button" className={'onece-player-icon'+(shuffle?' is-active':'')} title="Shuffle" aria-label="Shuffle" aria-pressed={shuffle} onClick={()=>setShuffle(v=>!v)}><Shuffle/></button>
    <button type="button" className={'onece-player-icon'+(repeat!=='off'?' is-active':'')} title={'Repeat: '+repeat} aria-label="Repeat" aria-pressed={repeat!=='off'} onClick={()=>setRepeat(v=>v==='off'?'all':v==='all'?'one':'off')}>{repeat==='one'?<Repeat1/>:<Repeat/>}</button>
    <button type="button" className={'onece-player-icon onece-player-queue'+(popup==='queue'?' is-active':'')} title="Playback queue" aria-label="Playback queue" aria-expanded={popup==='queue'} onClick={()=>setPopup(v=>v==='queue'?null:'queue')}><ListMusic/>{upcomingQueueV2(queue,current).length>0&&<span className="onece-queue-count">{upcomingQueueV2(queue,current).length}</span>}</button>
    <div className="onece-player-volume">
     <button type="button" className={'onece-player-icon'+(popup==='volume'?' is-active':'')} title="Volume" aria-label="Volume" aria-expanded={popup==='volume'} onClick={()=>setPopup(v=>v==='volume'?null:'volume')}>{muted||volume===0?<VolumeX/>:<Volume2/>}</button>
     {popup==='volume'&&<div className="onece-volume-popup v2-volume-popup" role="group" aria-label="Volume control"><div className="v2-volume-track"><input type="range" min="0" max="1" step="0.01" value={muted?0:volume} style={{'--volume-level':((muted?0:volume)*100)+'%'} as React.CSSProperties} onChange={e=>{setMuted(false);setVolume(Number(e.target.value))}} aria-label="Volume level" aria-orientation="vertical"/></div></div>}
    </div>
    </div>
   </div>
  </div>
  {playerError&&<p className="onece-player-error" role="alert">{playerError}</p>}
  {popup==='queue'&&<section className="onece-queue-popup" role="region" aria-label="Playback queue"><header><h2>Playback queue</h2><button type="button" className="onece-player-icon" aria-label="Close queue" onClick={()=>setPopup(null)}><X/></button></header><div className="onece-queue-current"><small>Now playing</small><p>{current.title}</p></div><ol>{upcomingQueueV2(queue,current).map((beat,index)=><li key={queueTrackKeyV2(beat)}><button type="button" className="onece-queue-track" onClick={()=>{setCurrent(beat);setActivePackId(beat.queue_pack_id??null);setElapsed(0);setPopup(null)}}><span>{String(index+1).padStart(2,'0')}</span><span>{beat.title}</span></button></li>)}</ol></section>}

 </>;
}
