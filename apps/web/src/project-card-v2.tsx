import React from 'react';
import ProjectCoverV2 from './project-cover-v2';
import './project-grid-tokens-v2.css';

export type ProjectCardModel={id:string;kind:'beat'|'pack';title:string;cover_file_id?:number|null;owner_id?:number|null};
type Props={
 id?:string;project:ProjectCardModel;ownerId?:number|null;variant:'library'|'profile';
 secondary:string;playing:boolean;onPlay?:()=>void;onOpen?:()=>void;
 onContextMenu?:(event:React.MouseEvent<HTMLElement>)=>void;
 onPointerEnter?:(event:React.PointerEvent<HTMLElement>)=>void;
 onFocusCapture?:(event:React.FocusEvent<HTMLElement>)=>void;
 tone?:number;className?:string;
};
function PlayIcon(){return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m8 5 12 7-12 7Z"/></svg>}
function PauseIcon(){return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>}

// One behavioral card with two layout variants. Media loading and Play control
// never belong to the owning view; only project actions/callbacks differ.
export default function ProjectCardV2({id,project,ownerId,variant,secondary,playing,onPlay,onOpen,onContextMenu,onPointerEnter,onFocusCapture,tone=0,className=''}:Props){
 const library=variant==='library';
 const art=<ProjectCoverV2 ownerId={ownerId??project.owner_id} fileId={project.cover_file_id} title={project.title} className={library?'v2-item-cover':'onece-profile-project-cover'} alt={library?project.title+' cover':''}/>;
 const play=onPlay?<button type="button" className={library?'v2-card-play':'v2-card-play onece-profile-project-play'} aria-label={(playing?'Pause ':'Play ')+project.title} title={playing?'Pause':'Play'} onClick={event=>{event.stopPropagation();onPlay()}}>{playing?<PauseIcon/>:<PlayIcon/>}</button>:null;
 return <article id={id} className={(library?'v2-library-card':'onece-profile-project')+(className?' '+className:'')}
  onContextMenu={onContextMenu} onPointerEnter={onPointerEnter} onFocusCapture={onFocusCapture}>
  {library?
   <div className={'beat-pack-art beat-art-'+tone+' v2-art-openable'} role="button" tabIndex={0}
    onClick={onOpen} onKeyDown={event=>{if(onOpen&&event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onOpen()}}}
    aria-label={'Open '+project.kind+' '+project.title}>{art}{play}</div>
   :<div className={'onece-profile-project-art'+(onOpen?' v2-art-openable':'')} role={onOpen?'button':undefined}
    tabIndex={onOpen?0:undefined} aria-label={onOpen?'Open '+project.kind+' '+project.title:undefined}
    onClick={onOpen} onKeyDown={event=>{if(onOpen&&event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onOpen()}}}>{art}{play}</div>}
  {library?<><div className="beat-pack-caption"><span className="v2-card-name">{project.title}</span></div><p>{secondary}</p></>
   :<div className="onece-profile-project-info"><strong>{project.title}</strong><span>{secondary}</span></div>}
 </article>;
}
