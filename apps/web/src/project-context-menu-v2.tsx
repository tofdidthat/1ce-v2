import React from 'react';
import {Bookmark,Eye,EyeOff,ListPlus,FolderPlus,Pencil,Image as ImageIcon,Download,Layers,Trash2,ChevronRight} from 'lucide-react';
import type {ContextProject,ProjectAction} from './project-action-dialog-v2';
import './library-items-v2.css';
import CopyLinkIconV2 from './copy-link-icon-v2';
export default function ProjectContextMenuV2({project,x,y,owner,published,saved,onPublish,onSave,onShare,onQueue,onDownload,onAction}:{project:ContextProject;x:number;y:number;owner:boolean;published:boolean;saved:boolean;onPublish?:()=>void;onSave?:()=>void;onShare?:()=>void;onQueue?:()=>void;onDownload?:()=>void;onAction:(action:ProjectAction)=>void}){
 const item=(label:string,icon:React.ReactNode,click?:()=>void,disabled=false,danger=false,trailingIcon?:React.ReactNode)=><button type="button" role="menuitem" className={'v2-context-action'+(danger?' v2-context-danger':'')} disabled={disabled} onClick={click}>{icon}<span>{label}</span>{trailingIcon}</button>;
 return <div className="v2-context-menu" role="menu" aria-label={'Actions for '+project.title} style={{position:'fixed',left:Math.max(8,Math.min(x,window.innerWidth-280)),top:Math.max(8,Math.min(y,window.innerHeight-460)),zIndex:1000}} onPointerDown={e=>e.stopPropagation()} onContextMenu={e=>e.preventDefault()}>
  {owner&&<>{item(published?'Unpublish':'Publish',published?<EyeOff size={17}/>:<Eye size={17}/>,onPublish,!onPublish)}<div className="v2-context-separator"/></>}
  {item(saved?'Unsave':'Save',<Bookmark size={17} fill={saved?'currentColor':'none'}/>,onSave,!onSave)}
  {item('Copy link',<CopyLinkIconV2 size={17}/>,onShare,!onShare)}
  {item('Add to queue',<ListPlus size={17}/>,onQueue,!onQueue)}
  {!owner&&<><div className="v2-context-separator"/>{item('Download MP3',<Download size={17}/>,onDownload,!onDownload)}</>}
  {owner&&<>{item('Add to...',<FolderPlus size={17}/>,()=>onAction('add'),false,false,<ChevronRight className="v2-context-chevron" size={15}/>)}
   <div className="v2-context-separator"/>
   {item('Rename',<Pencil size={17}/>,()=>onAction('rename'))}
   {item('Change cover',<ImageIcon size={17}/>,()=>onAction('cover'))}
   {item(project.kind==='pack'?'Download':'Download MP3',<Download size={17}/>,onDownload,!onDownload)}
   {project.kind==='beat'&&item('Upload/Download Stems',<Layers size={17}/>,()=>onAction('stems'))}
   <div className="v2-context-separator"/>
   {item('Delete',<Trash2 size={17}/>,()=>onAction('delete'),false,true)}</>}
 </div>;
}
