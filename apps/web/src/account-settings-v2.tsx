import React,{useEffect,useRef,useState} from 'react';
import {profilePictureV2} from './profile-picture-v2';
import {isAccountUserV2,type AccountUserV2} from './account-identity-v2';
import './account-settings-v2.css';
import {notifyV2DataChanged} from './data-refresh-v2';
import TrashSettingsV2 from './trash-settings-v2';
import {ArrowUpRight,ChevronRight,LogOut,ShieldCheck,Trash2,UserRound} from 'lucide-react';

const api=import.meta.env.VITE_API_URL;
async function request(path:string,options:RequestInit):Promise<AccountUserV2>{
 const response=await fetch(api+path,{...options,credentials:'include',cache:'no-store'});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||'Unable to save your account changes.');
 if(!isAccountUserV2(data.user))throw new Error('Account update was not confirmed.');
 return data.user;
}
function isValidUsername(value:string){
 return /^[a-z0-9][a-z0-9._]{1,22}[a-z0-9]$/.test(value)&&!value.includes('..')&&!/^[0-9]+$/.test(value);
}
export default function AccountSettingsV2({user,onUserChange,onViewProfile,onLogout}:{user:AccountUserV2;onUserChange:(user:AccountUserV2)=>void;onViewProfile:()=>void;onLogout:()=>Promise<void>}){
 const [editing,setEditing]=useState(false);
 const [trashOpen,setTrashOpen]=useState(false);
 useEffect(()=>{if(new URLSearchParams(window.location.search).get('edit')==='profile')setEditing(true);},[]);
 const [draft,setDraft]=useState(user.username||'');
 const [file,setFile]=useState<File|null>(null);
 const [removePhoto,setRemovePhoto]=useState(false);
 const [preview,setPreview]=useState('');
 const [error,setError]=useState('');
 const [saving,setSaving]=useState(false);
 const [loggingOut,setLoggingOut]=useState(false);
 const input=useRef<HTMLInputElement>(null);
 const fileInput=useRef<HTMLInputElement>(null);
 const busy=useRef(false);
 useEffect(()=>setDraft(user.username||''),[user.id,user.username]);
 useEffect(()=>{
  if(!file){setPreview('');return;}
  const url=URL.createObjectURL(file);setPreview(url);
  return()=>URL.revokeObjectURL(url);
 },[file]);
 useEffect(()=>{if(editing)input.current?.focus()},[editing]);
 const photo=editing&&preview?preview:editing&&removePhoto?(user.picture||''):profilePictureV2(user);
 function begin(){setDraft(user.username||'');setFile(null);setRemovePhoto(false);setError('');setEditing(true);}
 function cancel(){if(busy.current)return;setEditing(false);setDraft(user.username||'');setFile(null);setRemovePhoto(false);setError('');}
 function choosePhoto(event:React.ChangeEvent<HTMLInputElement>){
  const candidate=event.target.files?.[0];event.target.value='';
  if(!candidate)return;
  if(!['image/jpeg','image/png','image/webp'].includes(candidate.type)){setError('Use a JPEG, PNG or WebP image.');return;}
  if(candidate.size>5*1024*1024||candidate.size===0){setError('Choose a photo smaller than 5 MB.');return;}
  setFile(candidate);setRemovePhoto(false);setError('');
 }
 async function save(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy.current)return;
  const normalized=draft.trim().replace(/^@/,'').toLowerCase();
  if(!isValidUsername(normalized)){setError('Use 3–24 characters, without spaces. Start and end with a letter or number; no repeated dots or numbers-only usernames.');input.current?.focus();return;}
  if(!api){setError('API is not configured.');return;}
  busy.current=true;setSaving(true);setError('');
  let latest=user;
  let changed=false;
  try{
   if(file){
    latest=await request('/auth/me/avatar',{method:'POST',headers:{'Content-Type':file.type},body:file});
    onUserChange(latest);changed=true;setFile(null);
   }else if(removePhoto){
    latest=await request('/auth/me/avatar',{method:'DELETE'});
    onUserChange(latest);changed=true;setRemovePhoto(false);
   }
   if(normalized!==(latest.username||'')){
    latest=await request('/auth/me',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:normalized})});
    onUserChange(latest);changed=true;
   }
   setEditing(false);setDraft(latest.username||'');
  }catch(caught){setError(caught instanceof Error?caught.message:'Unable to save changes.');}
  finally{if(changed)notifyV2DataChanged(['identity'],latest.id);busy.current=false;setSaving(false);}
 }
 async function logout(){
  if(loggingOut)return;
  setLoggingOut(true);
  try{await onLogout();}catch(caught){setError(caught instanceof Error?caught.message:'Unable to log out.');setLoggingOut(false);}
 }
 return <section className="onece-account-settings" aria-label="Account settings">
  <div className="onece-account-layout">
   <aside className="onece-account-left">
    <section className="onece-account-card onece-account-user-card" aria-label="Your account">
     <div className="onece-account-avatar-wrap">
      <button type="button" className="onece-account-avatar" disabled={!editing||saving} aria-label={editing?'Change profile photo':'Profile photo'} onClick={()=>fileInput.current?.click()}>
       {photo?<img src={photo} alt="" referrerPolicy="no-referrer"/>:<span className="onece-account-avatar-initials" aria-hidden="true">{(user.username||user.name||'1CE').slice(0,2).toUpperCase()}</span>}
      </button>
      {editing&&(file||user.has_avatar)&&<button type="button" className="onece-account-avatar-remove" disabled={saving} title="Remove photo" aria-label="Remove photo" onClick={()=>{if(file)setFile(null);else setRemovePhoto(true);}}>×</button>}
      <input ref={fileInput} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={choosePhoto}/>
     </div>
     {editing?<form className="onece-account-form" onSubmit={event=>void save(event)}>
      <input ref={input} aria-label="Username" aria-invalid={!!error} value={draft} maxLength={25} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={saving} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();cancel();}}}/>
      <button type="submit" className="onece-account-confirm" disabled={saving} aria-label="Save changes" title="Save changes">{saving?'…':'✓'}</button>
      <button type="button" className="onece-account-cancel" disabled={saving} aria-label="Cancel editing" title="Cancel editing" onClick={cancel}>×</button>
     </form>:<div className="onece-account-identity">
      <h2>{user.username||'Choose username'}</h2>
      <p className="onece-account-membership-label">Your 1CE account</p>
      <button type="button" className="onece-account-edit" onClick={begin}>Edit info</button>
     </div>}
     {error&&<p className="onece-account-error" role="alert">{error}</p>}
    </section>
   </aside>
   <div className="onece-account-right">
    <section className="onece-account-card onece-account-profile-card">
     <div><h2>Profile</h2><p>Your projects, saved tracks and public links in one place.</p></div>
     <button type="button" className="onece-account-view" onClick={onViewProfile}>View <ArrowUpRight size={14} aria-hidden="true"/></button>
    </section>
    {trashOpen?<TrashSettingsV2 userId={user.id} onBack={()=>setTrashOpen(false)}/>:
    <>
     <section className="onece-account-card onece-account-links-card" aria-label="Storage">
      <h2 className="onece-account-group-heading">Storage</h2>
      <button type="button" className="onece-account-trash-link" onClick={()=>setTrashOpen(true)}><span className="onece-account-option-label"><Trash2 size={17} aria-hidden="true"/> Trash</span><ChevronRight size={16} aria-hidden="true"/></button>
     </section>
     <section className="onece-account-card onece-account-links-card" aria-label="Information">
      <h2 className="onece-account-group-heading">Information</h2>
      <a href="/terms"><span className="onece-account-option-label"><ShieldCheck size={17} aria-hidden="true"/> Terms of Service</span><ArrowUpRight size={15} aria-hidden="true"/></a>
      <a href="/privacy"><span className="onece-account-option-label"><UserRound size={17} aria-hidden="true"/> Privacy Policy</span><ArrowUpRight size={15} aria-hidden="true"/></a>
     </section>
     <section className="onece-account-card onece-account-links-card onece-account-session-card" aria-label="Session">
      <button type="button" className="onece-account-logout" disabled={loggingOut} onClick={()=>void logout()}><span className="onece-account-option-label"><LogOut size={17} aria-hidden="true"/>{loggingOut?'Logging out…':'Log out'}</span><ChevronRight size={16} aria-hidden="true"/></button>
     </section>
    </>}
   </div>
  </div>
 </section>;
}
