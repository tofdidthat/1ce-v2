import React,{useEffect,useRef,useState} from 'react';
import {profilePictureV2} from './profile-picture-v2';
import './account-settings-v2.css';
import {notifyV2DataChanged} from './data-refresh-v2';

const api=import.meta.env.VITE_API_URL;
type AccountUser={id:number;username?:string|null;picture?:string|null;has_avatar?:boolean;avatar_updated_at?:string|null;email?:string;[key:string]:unknown};
async function request(path:string,options:RequestInit):Promise<AccountUser>{
 const response=await fetch(api+path,{...options,credentials:'include',cache:'no-store'});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||'Unable to save your account changes.');
 if(!data.user)throw new Error('Account update was not confirmed.');
 return data.user as AccountUser;
}
function isValidUsername(value:string){
 return /^[a-z0-9][a-z0-9._]{1,22}[a-z0-9]$/.test(value)&&!value.includes('..')&&!/^[0-9]+$/.test(value);
}
export default function AccountSettingsV2({user,onUserChange,onViewProfile,onLogout}:{user:AccountUser;onUserChange:(user:AccountUser)=>void;onViewProfile:()=>void;onLogout:()=>Promise<void>}){
 const [editing,setEditing]=useState(false);
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
       {photo?<img src={photo} alt="" referrerPolicy="no-referrer"/>:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2Z"/></svg>}
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
      <button type="button" className="onece-account-edit" onClick={begin}>Edit</button>
     </div>}
     {error&&<p className="onece-account-error" role="alert">{error}</p>}
    </section>
   </aside>
   <div className="onece-account-right">
    <section className="onece-account-card onece-account-profile-card">
     <div><h2>Profile</h2><p>View your profile</p></div>
     <button type="button" className="onece-account-view" onClick={onViewProfile}>View <span aria-hidden="true">↗</span></button>
    </section>
    <section className="onece-account-card onece-account-links-card" aria-label="Account options">
     <a href="/terms">Terms of Service <span aria-hidden="true">↗</span></a>
     <a href="/privacy">Privacy Policy <span aria-hidden="true">↗</span></a>
     <button type="button" className="onece-account-logout" disabled={loggingOut} onClick={()=>void logout()}><span>{loggingOut?'Logging out…':'Log out'}</span><span aria-hidden="true">↗</span></button>
    </section>
   </div>
  </div>
 </section>;
}
