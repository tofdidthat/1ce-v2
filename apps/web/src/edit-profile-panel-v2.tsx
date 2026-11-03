import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Check,ChevronRight,Link2,Plus,Search,Trash2,X,Camera} from 'lucide-react';
import {profilePictureV2} from './profile-picture-v2';
import ProjectCoverV2 from './project-cover-v2';
import useProjectFlagsV2 from './project-flags-v2';
import {normalizeLibraryProjectsV2,type LibraryBeatV2,type LibraryPackV2,type ProfileProjectV2} from './project-read-v2';
import {notifyV2DataChanged} from './data-refresh-v2';
import {ProfileSocialLinksV2} from './profile-social-links-v2';
import './edit-profile-panel-v2.css';

const api=import.meta.env.VITE_API_URL;
type Project=LibraryBeatV2|LibraryPackV2;
type LibraryState={status:'idle'|'loading'|'ready'|'error';items:Project[];error:string};
const emptyLibrary:LibraryState={status:'idle',items:[],error:''};
const projectKey=(p:{kind:'beat'|'pack';id:string})=>p.kind+':'+p.id;
const validateUsername=(value:string)=>/^[a-z0-9][a-z0-9._]{1,22}[a-z0-9]$/.test(value)&&!value.includes('..')&&!/^\d+$/.test(value);

async function jsonRequest(path:string,options:RequestInit){
 if(!api)throw Error('API is not configured');
 const response=await fetch(api+path,{...options,credentials:'include',cache:'no-store'});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'Unable to save profile');
 return data;
}

export default function EditProfilePanelV2({user,profile,catalog,onClose,onIdentityUpdated,onProfileUpdated}:{
 user:any;profile:any;catalog:ProfileProjectV2[];
 onClose:()=>void;onIdentityUpdated:(updated:any)=>void;onProfileUpdated:()=>void;
}){
 const viewer=Number(user?.id);
 const [username,setUsername]=useState(String(profile?.username||user?.username||''));
 const [savedUsername,setSavedUsername]=useState(String(profile?.username||user?.username||''));
 const [editingUsername,setEditingUsername]=useState(false);
 const [usernameSaving,setUsernameSaving]=useState(false);
 const [links,setLinks]=useState<string[]>(Array.isArray(profile?.links)?profile.links:[]);
 const [linkEditor,setLinkEditor]=useState<{index:number;value:string}|null>(null);
 const [avatarFile,setAvatarFile]=useState<File|null>(null);
 const [removeAvatar,setRemoveAvatar]=useState(false);
 const [preview,setPreview]=useState('');
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [picker,setPicker]=useState(false);
 const [query,setQuery]=useState('');
 const [revision,setRevision]=useState(0);
 const [library,setLibrary]=useState<LibraryState>(emptyLibrary);
 const [busyKey,setBusyKey]=useState('');
 const fileInput=useRef<HTMLInputElement>(null);
 const {published,status:flagsStatus,error:flagsError,togglePublished,refresh:retryFlags}=useProjectFlagsV2();

 useEffect(()=>{
  if(!avatarFile){setPreview('');return;}
  const url=URL.createObjectURL(avatarFile);setPreview(url);
  return()=>URL.revokeObjectURL(url);
 },[avatarFile]);
 useEffect(()=>{
  const onKey=(event:KeyboardEvent)=>{
   if(event.key!=='Escape'||saving||busyKey||usernameSaving)return;
   if(picker)setPicker(false);
   else if(linkEditor)setLinkEditor(null);
   else if(editingUsername)cancelUsernameEdit();
   else onClose();
  };
  window.addEventListener('keydown',onKey);
  return()=>window.removeEventListener('keydown',onKey);
 },[picker,linkEditor,editingUsername,savedUsername,saving,usernameSaving,busyKey,onClose]);
 useEffect(()=>{
  if(!picker||!api||!Number.isSafeInteger(viewer)||viewer<1)return;
  const controller=new AbortController();
  setLibrary(previous=>({...previous,status:'loading',error:''}));
  void fetch(api+'/api/library/files/items',{credentials:'include',cache:'no-store',signal:controller.signal})
   .then(async response=>{if(!response.ok)throw Error('Unable to load Home');return response.json()})
   .then(data=>{
    if(controller.signal.aborted)return;
    const normalized=normalizeLibraryProjectsV2(data,viewer);
    setLibrary({status:'ready',items:[...normalized.packs,...normalized.beats.filter(beat=>beat.library_visible!==false)],error:''});
   }).catch(caught=>{
    if(!controller.signal.aborted)setLibrary({status:'error',items:[],error:caught instanceof Error?caught.message:'Unable to load Library'});
   });
  return()=>controller.abort();
 },[picker,viewer,revision]);
 const shownItems=useMemo(()=>{
  const term=query.trim().toLowerCase();
  return library.items.filter(item=>!term||item.title.toLowerCase().includes(term));
 },[library.items,query]);
 const previewProjects=useMemo(()=>{
  if(flagsStatus!=='ready')return catalog;
  if(library.status==='ready')return library.items.filter(item=>published.has(projectKey(item)));
  return catalog.filter(item=>published.has(projectKey(item)));
 },[library,catalog,published,flagsStatus]);

 function cancelUsernameEdit(){
  setUsername(savedUsername);
  setEditingUsername(false);
  setError('');
 }
 async function saveUsernameEdit(){
  if(usernameSaving||saving||busyKey)return;
  const normalized=username.trim().replace(/^@/,'').toLowerCase();
  if(!validateUsername(normalized)){
   setError('Username must be 3–24 characters without spaces or repeated dots.');
   return;
  }
  if(normalized===savedUsername){
   setUsername(normalized);setEditingUsername(false);setError('');return;
  }
  setUsernameSaving(true);setError('');
  try{
   const result=await jsonRequest('/auth/me',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:normalized})});
   setSavedUsername(normalized);setUsername(normalized);setEditingUsername(false);
   if(result.user)onIdentityUpdated(result.user);
   notifyV2DataChanged(['identity'],viewer);
   onProfileUpdated();
  }catch(caught){
   setError(caught instanceof Error?caught.message:'Unable to update username');
  }finally{setUsernameSaving(false);}
 }
 function editLink(index:number){
  setLinkEditor({index,value:index<0?'':links[index]||''});
  setError('');
 }
 function confirmLink(){
  if(!linkEditor)return;
  let value=linkEditor.value.trim();
  if(!/^[a-z][a-z\d+.-]*:\/\//i.test(value))value='https://'+value;
  try{
   const parsed=new URL(value);
   if(parsed.protocol!=='https:'||parsed.username||parsed.password||
      !parsed.hostname.includes('.')||parsed.hostname==='localhost'||parsed.port||value.length>500||
      /\s/.test(value))throw Error('Invalid link');
   const next=value.toString();
   if(links.some((existing,i)=>i!==linkEditor.index&&existing===next))throw Error('Duplicate link');
   setLinks(previous=>linkEditor.index<0?[...previous,next]:previous.map((url,i)=>i===linkEditor.index?next:url));
   setLinkEditor(null);setError('');
  }catch{setError('Enter a valid unique HTTPS link.');}
 }
 function chooseFile(event:React.ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];event.target.value='';
  if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024||!file.size){
   setError('Choose a valid JPEG, PNG or WebP photo under 5 MB.');return;
  }
  setAvatarFile(file);setRemoveAvatar(false);setError('');
 }
 async function saveProfile(){
  if(saving||usernameSaving||editingUsername||busyKey||linkEditor)return;
  setSaving(true);setError('');
  let changed=false;
  try{
   const newLinks=JSON.stringify(links)!==JSON.stringify(Array.isArray(profile?.links)?profile.links:[]);
   if(newLinks){
    const result=await jsonRequest('/auth/me',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({links})});
    if(result.user)onIdentityUpdated(result.user);
    changed=true;
   }
   if(avatarFile){
    const result=await jsonRequest('/auth/me/avatar',{method:'POST',headers:{'Content-Type':avatarFile.type},body:avatarFile});
    if(result.user)onIdentityUpdated(result.user);
    setAvatarFile(null);changed=true;
   }else if(removeAvatar){
    const result=await jsonRequest('/auth/me/avatar',{method:'DELETE'});
    if(result.user)onIdentityUpdated(result.user);
    setRemoveAvatar(false);changed=true;
   }
   if(changed)notifyV2DataChanged(['identity'],viewer);
   onProfileUpdated();onClose();
  }catch(caught){
   setError(caught instanceof Error?caught.message:'Unable to save profile');
   if(changed){notifyV2DataChanged(['identity'],viewer);onProfileUpdated();}
  }finally{setSaving(false);}
 }
 async function toggleProject(project:Project){
  if(!Number.isSafeInteger(viewer)||viewer<1||flagsStatus!=='ready'||busyKey)return;
  const key=projectKey(project);
  setBusyKey(key);setError('');
  try{
   await togglePublished(project.kind,project.id);
   onProfileUpdated();
  }catch(caught){setError(caught instanceof Error?caught.message:'Unable to update publication');}
  finally{setBusyKey('');}
 }
 const avatar=preview||(removeAvatar?(user?.picture||''):profilePictureV2(user));
 const name=String(savedUsername||profile?.name||user?.name||'Profile');
 const slots=Array.from({length:4},(_,i)=>previewProjects[i]||null);

 return <div className="onece-edit-overlay" onPointerDown={event=>{if(event.target===event.currentTarget&&!saving&&!busyKey)onClose();}}>
  <section className="onece-edit-sheet" role="dialog" aria-modal="true" aria-label="Edit profile">
   <header className="onece-edit-toolbar">
    <button type="button" aria-label="Close editor" title="Close" onClick={onClose} disabled={saving}><X size={20}/></button>
    <strong>Edit profile</strong>
    <button type="button" className="onece-edit-save" aria-label="Save profile" title="Save profile" onClick={()=>void saveProfile()} disabled={saving||usernameSaving||editingUsername||!!linkEditor}><Check size={19}/></button>
   </header>
   <div className="onece-edit-sections">
    <div className="onece-edit-profile-identity">
     <button className="onece-edit-avatar" type="button" onClick={()=>fileInput.current?.click()} aria-label="Change profile photo" title="Change profile photo">
      {avatar?<img src={avatar} alt=""/>:<span>{name.charAt(0).toUpperCase()}</span>}<Camera className="onece-edit-camera" size={18}/>
     </button>
     <input ref={fileInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile}/>
     {user?.has_avatar&&!removeAvatar&&<button className="onece-edit-remove-photo" type="button" onClick={()=>{setRemoveAvatar(true);setAvatarFile(null);}}>Remove photo</button>}
     <div className="onece-edit-username-row">
      {editingUsername?<>
       <input id="onece-edit-username" autoFocus aria-label="Username" value={username}
        onChange={e=>setUsername(e.target.value)} maxLength={25} autoComplete="off" spellCheck={false}
        placeholder="Username" disabled={usernameSaving}
        onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void saveUsernameEdit();}}}/>
       <span className="onece-edit-username-actions">
        <button type="button" aria-label="Cancel username edit" title="Cancel" onClick={cancelUsernameEdit} disabled={usernameSaving}><X size={17}/></button>
        <button type="button" aria-label="Save username" title="Save username" onClick={()=>void saveUsernameEdit()} disabled={usernameSaving}><Check size={17}/></button>
       </span>
      </>:<button type="button" className="onece-edit-username-display" aria-label="Edit username"
       title="Edit username" onClick={()=>{setUsername(savedUsername);setEditingUsername(true);setError('');}}>
       {savedUsername||'Set username'}
      </button>}
     </div>
    </div>
    <section className="onece-edit-links" aria-label="Edit profile links">
     <div className="onece-edit-section-heading"><h2>Links</h2><span>{links.length}/6</span></div>
     <ProfileSocialLinksV2 links={links} onAdd={links.length<6?()=>editLink(-1):undefined} onEdit={editLink}/>
     {linkEditor&&<div className="onece-edit-link-row">
      <div className="onece-edit-link-field"><Link2 size={17}/><input autoFocus aria-label="Profile link URL" type="url" inputMode="url" value={linkEditor.value} placeholder="https://..." onChange={e=>setLinkEditor({...linkEditor,value:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();confirmLink();}}}/></div>
      <button type="button" title="Cancel link editing" aria-label="Cancel link editing" onClick={()=>setLinkEditor(null)}><X size={17}/></button>
      <button type="button" title="Save link" aria-label="Save link" onClick={confirmLink}><Check size={17}/></button>
      {linkEditor.index>=0&&<button type="button" className="onece-edit-link-delete" title="Remove link" aria-label="Remove link" onClick={()=>{setLinks(previous=>previous.filter((_,i)=>i!==linkEditor.index));setLinkEditor(null);}}><Trash2 size={17}/></button>}
     </div>}
     <p className="onece-edit-help">Add Spotify, YouTube, Instagram or another public URL.</p>
    </section>
    <section className="onece-edit-published" aria-label="Published music">
     <div className="onece-edit-section-heading"><h2>Published</h2><span>{flagsStatus==='ready'?published.size:catalog.length} projects</span></div>
     <div className="onece-edit-published-grid">{slots.map((project,index)=>
      <button type="button" key={project?projectKey(project):'slot-'+index} className="onece-edit-published-slot" aria-label={project?'Manage '+project.title:'Add published project'} onClick={()=>{setPicker(true);setQuery('');}}>
       {project?<ProjectCoverV2 ownerId={viewer} fileId={project.cover_file_id} title={project.title} className="onece-edit-published-cover"/>:<Plus size={23}/>}
      </button>)}</div>
     <button type="button" className="onece-edit-view-all" onClick={()=>setPicker(true)}>Manage published projects <ChevronRight size={16}/></button>
    </section>
   </div>
   {error&&!picker&&<p className="onece-edit-error" role="alert">{error}</p>}
  </section>
  {picker&&<div className="onece-edit-picker-backdrop" onPointerDown={event=>{if(event.target===event.currentTarget&&!busyKey)setPicker(false);}}>
   <section className="onece-edit-picker" role="dialog" aria-modal="true" aria-label="Post to profile">
    <header><h2>Post to profile</h2><button type="button" aria-label="Close project picker" onClick={()=>setPicker(false)} disabled={!!busyKey}><X size={20}/></button></header>
    <div className="onece-edit-picker-search"><Search size={18}/><input aria-label="Search your Home" placeholder="Search your Home" value={query} onChange={e=>setQuery(e.target.value)}/></div>
    <div className="onece-edit-picker-results">
     {flagsStatus!=='ready'&&<div className="onece-edit-picker-state">{flagsStatus==='error'?(flagsError||'Unable to load publications'):'Loading publications…'}{flagsStatus==='error'&&<button type="button" onClick={retryFlags}>Retry</button>}</div>}
     {library.status==='loading'&&<div className="onece-edit-picker-state">Loading Home…</div>}
     {library.status==='error'&&<div className="onece-edit-picker-state" role="alert">{library.error} <button type="button" onClick={()=>setRevision(v=>v+1)}>Retry</button></div>}
     {library.status==='ready'&&shownItems.length===0&&<div className="onece-edit-picker-state">{query?'No projects match your search.':'Your Home is empty.'}</div>}
     {library.status==='ready'&&shownItems.map(project=>{
      const active=published.has(projectKey(project)),busy=busyKey===projectKey(project);
      return <button type="button" className="onece-edit-picker-project" key={projectKey(project)} onClick={()=>void toggleProject(project)}
       disabled={flagsStatus!=='ready'||!!busyKey} aria-label={(active?'Unpublish ':'Publish ')+project.title} aria-pressed={active}>
       <ProjectCoverV2 ownerId={viewer} fileId={project.cover_file_id} title={project.title} className="onece-edit-picker-cover"/>
       <span className="onece-edit-picker-description"><strong>{project.title}</strong><small>{project.kind==='pack'?('track_count' in project?project.track_count:0)+' tracks':'Beat'}</small></span>
       <span className={'onece-edit-picker-check'+(active?' is-published':'')} aria-hidden="true">{busy?'…':active?<Check size={17}/>:<Plus size={17}/>}</span>
      </button>;
     })}
    </div>
    {error&&<p className="onece-edit-error" role="alert">{error}</p>}
    <button className="onece-edit-picker-done" type="button" onClick={()=>setPicker(false)} disabled={!!busyKey}>Done</button>
   </section>
  </div>}
 </div>;
}
