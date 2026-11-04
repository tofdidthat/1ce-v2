// Ported from v1 src/workspace/WorkspaceShell.jsx and src/playback.jsx.
// Deliberately isolated from all v1 services, storage keys and databases.
import React,{useEffect,useState,useRef} from 'react';
import {House} from 'lucide-react';
import {useNavigate,useLocation} from 'react-router-dom';
import './workspace-v1.css';
import LibraryUploadV2 from './library-upload-v1';
import {subscribeV2DataChanges,subscribeV2Resume} from './data-refresh-v2';
import LibraryItemsV2 from './library-items-v2';
import PublicProfileV2 from './public-profile-v2';
import WorldV2 from './world-v2';
import {ProjectFlagsProviderV2} from './project-flags-v2';
import {ProjectCoverCacheProviderV2} from './project-cover-v2';
import AccountSettingsV2 from './account-settings-v2';
import {profilePictureV2} from './profile-picture-v2';
type WorkspaceUser={id:number;username?:string|null;picture?:string|null;has_avatar?:boolean;avatar_updated_at?:string|null;email?:string;[key:string]:unknown};
type WorkspaceView='library'|'discover'|'upload'|'account'|'edit-profile'|'profile';
function HomeMark() {
  // Home navigation uses a house. The Catalog tab retains its own 3-stroke glyph.
  return <House className="w-5 h-5" size={22} strokeWidth={1.7} aria-hidden="true"/>;
}
function GlobeMark({ className = 'w-5 h-5' }:{className?:string}) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></svg>
}
function UploadMark() {
  return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V3" /><path d="m7 8 5-5 5 5" /><path d="M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
}
function AdjustMark() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3v3m0 4v11M12 3v9m0 4v5M18 3v3m0 4v11" /><path d="M4 6h4v4H4zM10 12h4v4h-4zM16 6h4v4h-4z" /></svg>
}

function EditProfileMark(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4Z"/></svg>}
function SettingsMark(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831 2.34 2.34 0 0 1 2.33-4.033 2.34 2.34 0 0 0 3.32-1.915" /><circle cx="12" cy="12" r="3" /></svg>}

function CompactWorkspaceNav({ view, disabled, onNavigate }:{view:WorkspaceView;disabled:boolean;onNavigate:(next:string)=>void}) {
  const [open, setOpen] = useState(false)
  const root = React.useRef<HTMLElement|null>(null)
  const trigger = React.useRef<HTMLButtonElement|null>(null)
  const options = React.useRef<Array<HTMLButtonElement|null>>([])
  const items = [
    { id: 'library', label: 'Home', icon: <HomeMark /> },
    { id: 'discover', label: 'World', icon: <GlobeMark /> },
    { id: 'upload', label: 'Upload', icon: <UploadMark /> },
    { id: 'account', label: 'Settings', icon: <SettingsMark /> }
  ]
  const current = items.find(item => item.id === view) || items[0]
  const listId = React.useId()
  const pointerInside = React.useRef(false)
  const suppressHover = React.useRef(false)

  useEffect(() => { setOpen(false) }, [view])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useEffect(() => {
    if (!open) return
    const outside = (event:PointerEvent) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event:KeyboardEvent) => {
      if (event.key === 'Escape' && root.current?.contains(document.activeElement)) {
        event.preventDefault()
        suppressHover.current = true
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const focusOption = (index:number) => {
    setOpen(true)
    requestAnimationFrame(() => options.current[index]?.focus())
  }
  const select = (id:string) => {
    onNavigate(id)
    suppressHover.current = true
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <nav
      ref={root}
      className={'onece-compact-nav' + (open ? ' is-open' : '')}
      aria-label="Main navigation"
      onPointerEnter={event => {
        if (event.pointerType === 'mouse') {
          pointerInside.current = true
          if (!disabled && !suppressHover.current) setOpen(true)
        }
      }}
      onPointerLeave={event => {
        if (event.pointerType === 'mouse') {
          pointerInside.current = false
          suppressHover.current = false
          if (!root.current?.contains(document.activeElement)) setOpen(false)
        }
      }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget) && !pointerInside.current) setOpen(false)
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="library-settings onece-nav-trigger"
        title={current.label + ' — Open navigation'}
        aria-label={current.label + ' — Open navigation'}
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        tabIndex={open ? -1 : 0}
        onClick={event => {
          if (open) {
            setOpen(false)
            suppressHover.current = true
          } else if (event.detail === 0) {
            // Keyboard/assistive activation: move focus into the expanded menu.
            focusOption(items.indexOf(current))
          } else {
            // Touch/click: open without moving focus during the reveal.
            // A focus transfer here can blur the nav and close it on mobile.
            setOpen(true)
          }
        }}
        onKeyDown={event => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            focusOption(event.key === 'End' || event.key === 'ArrowUp' ? items.length - 1 : 0)
          }
        }}
      >
        {current.icon}
      </button>
      <div className="onece-nav-reveal" id={listId} aria-hidden={!open}>
        <div className="onece-nav-list">
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={element => { options.current[index] = element }}
              type="button"
              className="library-settings"
              title={item.label}
              aria-label={item.label}
              aria-current={item.id === view ? 'page' : undefined}
              disabled={disabled}
              tabIndex={open ? 0 : -1}
              onClick={() => select(item.id)}
              onKeyDown={event => {
                let next
                if (event.key === 'ArrowDown') next = (index + 1) % items.length
                else if (event.key === 'ArrowUp') next = (index + 2) % items.length
                else if (event.key === 'Home') next = 0
                else if (event.key === 'End') next = items.length - 1
                else return
                event.preventDefault()
                options.current[next]?.focus()
              }}
            >
              {item.icon}
            </button>
          ))}
        </div>
      </div>
    </nav>
  )
}


function HeaderV2({view,user,onNavigate,externalProfile}:{view:WorkspaceView;user:WorkspaceUser|null;externalProfile:boolean;onNavigate:(next:string)=>void}){
 const picture=profilePictureV2(user);
 const ownProfileAction=view==='profile'&&!externalProfile;
 return <>
 <style>{`.onece-workspace-header {
  position: fixed;
  inset: 0 0 auto;
  z-index: 50;
  box-sizing: border-box;
  height: calc(80px + env(safe-area-inset-top));
  padding: calc(18px + env(safe-area-inset-top)) max(64px, env(safe-area-inset-right)) 18px max(64px, env(safe-area-inset-left));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  background: transparent;
  isolation: isolate;
}
.onece-workspace-header::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: rgba(9, 8, 14, .94);
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 calc(100% - 20px), rgba(0, 0, 0, .85) calc(100% - 14px), rgba(0, 0, 0, .3) calc(100% - 7px), transparent 100%);
  mask-image: linear-gradient(to bottom, #000 0%, #000 calc(100% - 20px), rgba(0, 0, 0, .85) calc(100% - 14px), rgba(0, 0, 0, .3) calc(100% - 7px), transparent 100%);
}
@supports ((backdrop-filter: blur(10px)) or (-webkit-backdrop-filter: blur(10px))) {
  .onece-workspace-header::before {
    background: linear-gradient(to bottom, rgba(9, 8, 14, .92) 0%, rgba(9, 8, 14, .82) calc(100% - 20px));
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
  }
}
.onece-workspace-brand { display: flex; align-items: center; width: 140px; height: 48px; min-width: 0; flex: 0 1 140px; transform: translateY(6px); }
.onece-workspace-brand img { display: block; width: 140px; height: 48px; max-width: 100%; object-fit: contain; object-position: left center; }
.onece-workspace-logo-home { display: flex; align-items: center; justify-content: flex-start; width: 100%; height: 100%; padding: 0; margin: 0; border: 0; background: transparent; color: inherit; cursor: pointer; }
.onece-workspace-logo-home:focus-visible { outline: 2px solid #a78bfa; outline-offset: 4px; border-radius: 4px; }
.onece-workspace-actions { display: flex; align-items: center; flex: 0 0 auto; gap: 12px; height: 48px; transform: translateY(6px); }
.onece-workspace-header .library-settings {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  padding: 0;
  margin: 0;
  border: 1px solid #ffffff0b;
  border-radius: 14px;
  background: #ffffff05;
  color: #aaa1b6;
  cursor: pointer;
  transition: background 160ms ease, color 160ms ease;
}
.onece-workspace-header .library-settings:hover:not(:disabled) { background: #ffffff0b; color: #f5f3ff; }
.onece-workspace-header .library-settings:focus-visible { outline: 2px solid #a78bfa; outline-offset: 4px; }
.onece-workspace-header .library-settings:disabled { opacity: .35; cursor: default; }
.onece-workspace-header .library-settings svg { display: block; width: 22px; height: 22px; flex-shrink: 0; }
.onece-workspace-header .library-profile-trigger > img { display: block; flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; object-fit: cover; }
.onece-compact-nav { position: relative; flex: 0 0 44px; width: 44px; height: 44px; }
.onece-compact-nav.is-open > .onece-nav-trigger { opacity: 0; pointer-events: none; }
.onece-nav-reveal { position: absolute; z-index: 1; inset: 0 auto auto 0; width: 44px; display: grid; grid-template-rows: 0fr; opacity: 0; visibility: hidden; pointer-events: none; border-radius: 14px; background: #09080e; transition: grid-template-rows 220ms ease, opacity 160ms ease, visibility 220ms; }
.onece-compact-nav.is-open .onece-nav-reveal { grid-template-rows: 1fr; opacity: 1; visibility: visible; pointer-events: auto; }
.onece-nav-list { min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 12px; }
.onece-workspace-shell .library-page > .library-header { visibility: hidden; pointer-events: none; }
.onece-workspace-shell:not(.onece-library-view) > main { padding-top: calc(80px + env(safe-area-inset-top)); }
@media (max-width: 600px) {
  .onece-workspace-header { height: calc(76px + env(safe-area-inset-top)); padding: calc(16px + env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 16px max(16px, env(safe-area-inset-left)); gap: 12px; }
  .onece-workspace-shell:not(.onece-library-view) > main { padding-top: calc(76px + env(safe-area-inset-top)); }
  .onece-workspace-brand, .onece-workspace-actions { transform: translateY(4px); }
}
@media (prefers-reduced-motion: reduce) {
  .onece-workspace-header .library-settings, .onece-nav-reveal { transition: none; }
}
`}</style>
 {view==='profile'?null:<header className="onece-workspace-header" aria-label="Workspace header">
 <div className="onece-workspace-brand"><button type="button" className="onece-workspace-logo-home" aria-label="Go to Home" title="Home" onClick={()=>onNavigate('library')}><img src="/1ce-logo.png" alt="1CE"/></button></div>
 <div className="onece-workspace-actions">
 <button type="button" className="library-settings library-profile-trigger" title={ownProfileAction?'Edit Profile':'My Profile'} aria-label={ownProfileAction?'Edit Profile':'My Profile'} onClick={()=>onNavigate(ownProfileAction?'edit-profile':'profile')}>
 {ownProfileAction ? <EditProfileMark/> : picture ? <img src={picture} alt="" referrerPolicy="no-referrer"/> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2Z"/></svg>}
 </button>
 <CompactWorkspaceNav view={view} disabled={false} onNavigate={onNavigate}/></div></header>}</>;
}
function EmptyLibrary({onUpload}:{onUpload:()=>void}){
 return <section className="beat-profile library-page onece-v2-library">
  <div className="beat-profile-content">
   <div className="library-items">
    <div className="library-empty"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 4v16M9 4v16M14 4l4 16"/></svg><h2>Your Home is empty</h2><button type="button" className="library-add-audio" onClick={onUpload}>Add Audio</button></div>
   </div>
  </div>
 </section>;
}
export default function WorkspaceV2({user,profileId}:{user:WorkspaceUser|null;profileId?:string}){
 const navigate=useNavigate();const location=useLocation();
 const [account,setAccount]=useState<WorkspaceUser|null>(user);
 useEffect(()=>setAccount(user),[user?.id]);
 // Revalidate identity when another tab updates the avatar/username, or
 // after returning from a different browser window. Never overwrite a
 // different signed-in account during an in-flight request.
 useEffect(()=>{
  const id=account?.id;
  if(!id)return;
  const api=import.meta.env.VITE_API_URL;
  if(!api)return;
  let alive=true;
  let generation=0;
  const refresh=async()=>{
   const request=++generation;
   try{
    const response=await fetch(api+'/auth/me',{credentials:'include',cache:'no-store'});
    if(!response.ok)return;
    const data=await response.json();
    const updated=data.user||data;
    if(alive&&request===generation&&String(updated?.id)===String(id)){
     setAccount(current=>String(current?.id)===String(id)?updated as WorkspaceUser:current);
    }
   }catch{ /* leave previous identity visible until the next revalidation */ }
  };
  const unsubscribe=subscribeV2DataChanges(['identity'],()=>void refresh(),id);
  const unsubscribeFocus=subscribeV2Resume(()=>void refresh());
  return()=>{alive=false;generation++;unsubscribe();unsubscribeFocus();};
 },[account?.id]);
 const logout=async()=>{const api=import.meta.env.VITE_API_URL;if(!api)throw Error('API is not configured');const response=await fetch(api+'/auth/logout',{method:'POST',credentials:'include'});if(!response.ok)throw Error('Could not log out');window.location.assign('/login');};
 const [playerVisible,setPlayerVisible]=useState(false);
 const [playRequest,setPlayRequest]=useState<{ownerId:number;kind:'beat'|'pack';id:string;nonce:number}|null>(null);
 const [queueRequest,setQueueRequest]=useState<{ownerId:number;kind:'beat'|'pack';id:string;nonce:number}|null>(null);
 const [playback,setPlayback]=useState<{ownerId:number;kind:'beat'|'pack';id:string;playing:boolean}|null>(null);
 const requestPlayback=(ownerId:number,kind:'beat'|'pack',id:string)=>setPlayRequest(previous=>({ownerId,kind,id,nonce:(previous?.nonce||0)+1}));
 const requestQueue=(ownerId:number,kind:'beat'|'pack',id:string)=>setQueueRequest(previous=>({ownerId,kind,id,nonce:(previous?.nonce||0)+1}));
 const view:WorkspaceView=profileId?'profile':location.pathname==='/app/library'?'library':location.pathname.endsWith('/discover')?'discover':location.pathname.endsWith('/upload')?'upload':location.pathname.endsWith('/settings')?'account':location.pathname.endsWith('/profile/edit')?'edit-profile':'profile';
 // Keep up to three recent profile read-models mounted, but without offscreen
 // cards/image leases. The one Workspace cover cache supplies immediate URLs
 // on Back; each returned profile still refetches authorized metadata.
 const activeProfileKey=view==='profile'?(profileId?'public:'+profileId:'own'):null;
 const [recentProfiles,setRecentProfiles]=useState<string[]>(()=>activeProfileKey?[activeProfileKey]:[]);
 useEffect(()=>{
  if(!activeProfileKey)return;
  setRecentProfiles(previous=>{
   if(previous[previous.length-1]===activeProfileKey)return previous;
   return [...previous.filter(key=>key!==activeProfileKey),activeProfileKey].slice(-3);
  });
 },[activeProfileKey]);
 useEffect(()=>{
  // A different authenticated account must not retain earlier private metadata.
  setRecentProfiles(activeProfileKey?[activeProfileKey]:[]);
 },[account?.id]);
 const visibleProfileKeys=activeProfileKey&&!recentProfiles.includes(activeProfileKey)?
  [...recentProfiles.slice(-2),activeProfileKey]:recentProfiles;
 const onNavigate=(next:string)=>navigate(next==='library'?'/app/library':next==='account'?'/app/settings':next==='edit-profile'?'/app/profile/edit':'/app/'+next);
 useEffect(()=>{document.title=({library:'Home',discover:'World',upload:'Upload',account:'Settings',profile:'Profile','edit-profile':'Edit Profile'}[view]||'Home')+' — 1CE'},[view]);
 return <ProjectCoverCacheProviderV2 viewerId={Number(account?.id)||null}><ProjectFlagsProviderV2 viewerId={Number(account?.id)||null}><div className={'onece-workspace-shell'+(view==='library'?' onece-library-view':'')}>
 <style>{`.onece-library-inactive{position:static!important;padding:0!important;margin:0!important;min-height:0!important;height:0!important;overflow:visible!important}.onece-library-inactive>.beat-profile-content{display:none!important}`}</style>
 <HeaderV2 view={view} user={account} externalProfile={Boolean(profileId)} onNavigate={onNavigate}/>
 <main className="onece-v2-workspace-main">
 <LibraryItemsV2 active={view==='library'} playRequest={playRequest} queueRequest={queueRequest} userId={account?.id} onUpload={()=>onNavigate('upload')} onPlayerVisibility={setPlayerVisible} onPlaybackChange={setPlayback}/>
 {visibleProfileKeys.map(profileKey=><PublicProfileV2 key={String(account?.id||'anonymous')+':'+profileKey}
  active={activeProfileKey===profileKey} user={account} profileId={profileKey==='own'?undefined:profileKey.slice('public:'.length)}
  playback={playback} onPlayProject={requestPlayback} onQueueProject={requestQueue}
  onIdentityUpdated={updated=>{
    const oldHandle=String(account?.username||'').toLowerCase();
    setAccount(updated);
    if(profileId&&oldHandle&&profileId.toLowerCase()===oldHandle&&updated?.username&&
       String(updated.username).toLowerCase()!==oldHandle){
      navigate('/u/'+encodeURIComponent(updated.username),{replace:true});
    }
   }}
  onBack={()=>{const index=window.history.state?.idx;if(typeof index==='number'&&index>0)navigate(-1);else navigate(account?.id?'/app/library':'/');}}
  onLogin={()=>navigate('/login')}
  onOpenProfile={identifier=>navigate('/u/'+encodeURIComponent(identifier))}/>)}
 {view==='library'||view==='profile'?null:
 view==='discover'?<WorldV2 userId={account?.id} onOpenProfile={identifier=>navigate('/u/'+encodeURIComponent(identifier))}/>:
 view==='upload'?<LibraryUploadV2 userId={account?.id}/>:
 view==='account'&&account?<AccountSettingsV2 user={account} onUserChange={setAccount} onViewProfile={()=>onNavigate('profile')} onLogout={logout}/>:
view==='edit-profile'?<section className="onece-workspace-placeholder"><h1>Edit Profile</h1><p>Profile editing is not yet available in v2.</p></section>:
 <section className="onece-workspace-placeholder"><h1>Settings</h1><p>Account settings are not yet available in v2.</p></section>}
 </main>
 {view==='library'&&!playerVisible&&<div className="onece-player-dock" aria-label="Add audio"><button type="button" className="onece-global-player" style={{display:'flex',justifyContent:'center',gap:10,width:'fit-content',maxWidth:'100%',marginInline:'auto',padding:'7px 26px',color:'inherit',font:'inherit',fontSize:13,cursor:'pointer'}} onClick={()=>onNavigate('upload')}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Add file</span></button></div>}
 </div></ProjectFlagsProviderV2></ProjectCoverCacheProviderV2>;
}
