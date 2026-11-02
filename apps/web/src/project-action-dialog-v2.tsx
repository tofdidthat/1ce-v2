import React,{useEffect,useState} from 'react';
import {notifyV2DataChanged} from './data-refresh-v2';
import './project-action-dialog-v2.css';

export type ContextProject={kind:'beat'|'pack';id:string;title:string;cover_file_id?:number|null};
export type ProjectAction='add'|'rename'|'cover'|'delete';
export type ChangedProject={action:ProjectAction;source:ContextProject;title?:string;coverFileId?:number|null;targetPackId?:string;newPackId?:string};
type PackOption={id:string;title:string;track_count:number};
const api=import.meta.env.VITE_API_URL;

async function jsonRequest(path:string,method:string,body?:unknown){
 if(!api)throw Error('API is not configured');
 const response=await fetch(api+path,{
  method,credentials:'include',cache:'no-store',
  ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'Unable to update project');
 return data;
}
async function sendCover(file:File){
 const extension=file.name.toLowerCase().split('.').pop();
 const allowed:Record<string,string[]>={'image/jpeg':['jpg','jpeg'],'image/png':['png'],'image/webp':['webp']};
 if(!allowed[file.type]?.includes(extension||''))throw Error('Use a JPG, PNG or WebP image with the matching file extension');
 if(!file.size||file.size>15*1024*1024)throw Error('Cover must be between 1 byte and 15 MB');
 const bytes=await file.arrayBuffer();
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 const sha256=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
 const init=await jsonRequest('/api/library/files/init','POST',{kind:'cover',name:file.name,contentType:file.type,size:file.size,sha256});
 if(init.reused)return Number(init.id);
 const result=await fetch(init.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type},body:file});
 if(!result.ok)throw Error('Cover could not be uploaded to private storage');
 const complete=await jsonRequest('/api/library/files/'+init.id+'/complete','POST');
 return Number(complete.id);
}

export default function ProjectActionDialogV2({
 project,action,packs,userId,onClose,onChanged
}:{
 project:ContextProject;action:ProjectAction;packs:PackOption[];userId?:number;
 onClose:()=>void;onChanged:(change:ChangedProject)=>void;
}){
 const [title,setTitle]=useState(action==='rename'?project.title:project.title+' pack');
 const [destination,setDestination]=useState('');
 const [targetPackId,setTargetPackId]=useState('');
 const [file,setFile]=useState<File|null>(null);
 const [removeCover,setRemoveCover]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const existing=packs.filter(p=>p.id!==project.id);
 useEffect(()=>{
  const handler=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busy)onClose()};
  document.addEventListener('keydown',handler);
  return()=>document.removeEventListener('keydown',handler);
 },[busy,onClose]);
 async function submit(event:React.FormEvent){
  event.preventDefault();
  if(busy)return;
  setBusy(true);setError('');
  try{
   const root='/api/library/projects/';
   let change:ChangedProject={action,source:project};
   if(action==='rename'){
    const name=title.trim();
    if(!name||name.length>180)throw Error('Name must be between 1 and 180 characters');
    await jsonRequest(root+project.kind+'/'+project.id,'PATCH',{title:name});
    change={...change,title:name};
   }else if(action==='cover'){
    if(!file&&!removeCover)throw Error('Choose an image or remove the existing cover');
    const coverFileId=removeCover?null:await sendCover(file!);
    await jsonRequest(root+project.kind+'/'+project.id,'PATCH',{coverFileId});
    change={...change,coverFileId};
   }else if(action==='delete'){
    await jsonRequest(root+project.kind+'/'+project.id,'DELETE');
   }else if(destination==='new'){
    const name=title.trim();
    if(!name||name.length>180)throw Error('Name must be between 1 and 180 characters');
    const result=await jsonRequest(root+'packs/from','POST',{title:name,sourceKind:project.kind,sourceId:project.id});
    change={...change,newPackId:result.id};
   }else if(destination==='existing'){
    if(!targetPackId)throw Error('Choose an existing pack');
    await jsonRequest(root+'pack/'+targetPackId+'/add','POST',{sourceKind:project.kind,sourceId:project.id});
    change={...change,targetPackId};
   }else throw Error('Choose a destination');
   notifyV2DataChanged(['library','publications','saves','shares'],userId);
   onChanged(change);
  }catch(err){setError(err instanceof Error?err.message:'Unable to update project');}
  finally{setBusy(false);}
 }
 const actionLabel=action==='rename'?'Rename':action==='cover'?'Change cover':action==='delete'?'Delete':'Add to';
 return <div className="v2-project-dialog-overlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose()}}>
  <section className="v2-project-dialog" role="dialog" aria-modal="true" aria-labelledby="v2-project-dialog-title">
   <header><h2 id="v2-project-dialog-title">{actionLabel}</h2><button type="button" aria-label="Close" onClick={onClose} disabled={busy}>×</button></header>
   <p className="v2-project-dialog-subtitle">{project.title} · {project.kind==='beat'?'Beat':'Pack'}</p>
   <form onSubmit={event=>void submit(event)}>
    {action==='rename'&&<label className="v2-project-dialog-field">Project name<input required autoFocus maxLength={180} value={title} disabled={busy} onChange={event=>setTitle(event.target.value)}/></label>}
    {action==='add'&&<>
     <p className="v2-project-dialog-help">Adds references to the original beats; audio and stems are not duplicated.</p>
     <label className="v2-project-dialog-option"><input type="radio" checked={destination==='existing'} onChange={()=>setDestination('existing')} disabled={busy}/> Existing pack</label>
     {destination==='existing'&&<select value={targetPackId} aria-label="Existing pack" onChange={event=>setTargetPackId(event.target.value)} disabled={busy} required>
      <option value="">Select a pack</option>{existing.map(pack=><option key={pack.id} value={pack.id}>{pack.title} ({pack.track_count} beats)</option>)}
     </select>}
     {!existing.length&&<p className="v2-project-dialog-help">No other packs yet. Create a new project below.</p>}
     <label className="v2-project-dialog-option"><input type="radio" checked={destination==='new'} onChange={()=>setDestination('new')} disabled={busy}/> New project (pack)</label>
     {destination==='new'&&<label className="v2-project-dialog-field">Pack name<input required autoFocus maxLength={180} value={title} disabled={busy} onChange={event=>setTitle(event.target.value)}/></label>}
    </>}
    {action==='cover'&&<>
     <label className="v2-project-dialog-field">New cover image
      <input type="file" accept=".jpg,.jpeg,.png,.webp" disabled={busy||removeCover} onChange={event=>setFile(event.target.files?.[0]||null)}/>
     </label>
     {project.cover_file_id!=null&&<label className="v2-project-dialog-option"><input type="checkbox" checked={removeCover} disabled={busy} onChange={event=>{setRemoveCover(event.target.checked);if(event.target.checked)setFile(null)}}/> Remove current cover</label>}
     <p className="v2-project-dialog-help">JPG, PNG or WebP, up to 15 MB. Original audio and stems will not change.</p>
    </>}
    {action==='delete'&&<p className="v2-project-dialog-warning">
     {project.kind==='beat'
      ?'Delete this beat permanently from the Library, Catalog, Saves and any packs that contain it? Other beats in those packs are preserved.'
      :'Delete this pack permanently? The beats inside it remain in your Library and any other packs.'}
     {' '}Existing media files are retained in private storage. This action cannot be undone.
    </p>}
    {error&&<p className="v2-project-dialog-error" role="alert">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button>
     <button type="submit" className={action==='delete'?'danger':''} disabled={busy||(action==='add'&&!destination)||(action==='cover'&&!file&&!removeCover)}>{busy?'Saving…':action==='delete'?'Delete':action==='add'?'Add':action==='cover'?'Save cover':'Save'}</button>
    </footer>
   </form>
  </section>
 </div>;
}
