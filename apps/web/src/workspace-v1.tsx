// @ts-nocheck
// Ported from v1 src/workspace/WorkspaceShell.jsx and src/playback.jsx.
// Deliberately isolated from all v1 services, storage keys and databases.
import React,{useEffect,useState,useRef} from 'react';
import {useNavigate,useLocation} from 'react-router-dom';
import './workspace-v1.css';
function HomeMark() {
  return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-7h6v7" /></svg>
}
function GlobeMark({ className = 'w-5 h-5' }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></svg>
}
function UploadMark() {
  return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V3" /><path d="m7 8 5-5 5 5" /><path d="M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
}
function AdjustMark() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3v3m0 4v11M12 3v9m0 4v5M18 3v3m0 4v11" /><path d="M4 6h4v4H4zM10 12h4v4h-4zM16 6h4v4h-4z" /></svg>
}

function SettingsMark(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831 2.34 2.34 0 0 1 2.33-4.033 2.34 2.34 0 0 0 3.32-1.915" /><circle cx="12" cy="12" r="3" /></svg>}

function CompactWorkspaceNav({ view, disabled, onNavigate }) {
  const [open, setOpen] = useState(false)
  const root = React.useRef(null)
  const trigger = React.useRef(null)
  const options = React.useRef([])
  const items = [
    { id: 'library', label: 'Home', icon: <HomeMark /> },
    { id: 'discover', label: 'Discover', icon: <GlobeMark /> },
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
    const outside = event => {
      if (!root.current?.contains(event.target)) setOpen(false)
    }
    const escape = event => {
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

  const focusOption = index => {
    setOpen(true)
    requestAnimationFrame(() => options.current[index]?.focus())
  }
  const select = id => {
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
        onClick={() => {
          if (open) {
            setOpen(false)
            suppressHover.current = true
          } else focusOption(items.indexOf(current))
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


function HeaderV2({view,user,onNavigate}){
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
.onece-compact-nav.is-open > .onece-nav-trigger { visibility: hidden; pointer-events: none; }
.onece-nav-reveal { position: absolute; inset: 0 auto auto 0; width: 44px; display: grid; grid-template-rows: 0fr; opacity: 0; visibility: hidden; border-radius: 14px; background: #09080e; transition: grid-template-rows 220ms ease, opacity 160ms ease, visibility 220ms; }
.onece-compact-nav.is-open .onece-nav-reveal { grid-template-rows: 1fr; opacity: 1; visibility: visible; }
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
 <header className="onece-workspace-header" aria-label="Workspace header">
 <div className="onece-workspace-brand"><img src="/1ce-logo.png" alt="1CE"/></div>
 <div className="onece-workspace-actions">
 <CompactWorkspaceNav view={view} disabled={false} onNavigate={onNavigate}/>
 <button type="button" className="library-settings library-profile-trigger" title="Public Profile" aria-label="Public Profile" onClick={()=>onNavigate('profile')}>
 {user?.customPicture||user?.picture ? <img src={user.customPicture||user.picture} alt="" referrerPolicy="no-referrer"/> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2Z"/></svg>}
 </button></div></header></>;
}
function EmptyLibrary({onUpload}){
 return <section className="beat-profile library-page onece-v2-library">
  <div className="beat-profile-content">
   <div className="library-items">
    <div className="library-empty"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 4v16M9 4v16M14 4l4 16"/></svg><h2>Your Library is Empty</h2><button type="button" className="library-add-audio" onClick={onUpload}>Add Audio</button></div>
   </div>
  </div>
 </section>;
}
function UploadView(){
 const input=useRef(null);const [selection,setSelection]=useState([]);
 return <section className="onece-workspace-placeholder"><h1>Upload</h1><p>Choose audio files for your Library. File storage is not enabled in the v2 API yet.</p>
 <input ref={input} type="file" accept="audio/*,.mp3,.wav,.flac,.aiff,.m4a" multiple onChange={event=>setSelection(Array.from(event.target.files||[]))} aria-label="Choose audio files"/>
 {selection.length>0&&<div role="status">{selection.map(f=><p key={f.name+f.size}>{f.name} · {(f.size/1024/1024).toFixed(2)} MB</p>)}<p>Selected locally; nothing uploaded.</p></div>}
 </section>;
}
export default function WorkspaceV2({user}){
 const navigate=useNavigate();const location=useLocation();
 const view=location.pathname==='/app/library'?'library':location.pathname.endsWith('/discover')?'discover':location.pathname.endsWith('/upload')?'upload':location.pathname.endsWith('/settings')?'account':'profile';
 const onNavigate=(next)=>navigate(next==='library'?'/app/library':next==='account'?'/app/settings':'/app/'+next);
 useEffect(()=>{document.title=({library:'Library',discover:'Discover',upload:'Upload',account:'Settings',profile:'Profile'}[view]||'Library')+' — 1CE'},[view]);
 return <div className={'onece-workspace-shell'+(view==='library'?' onece-library-view':'')}>
 <HeaderV2 view={view} user={user} onNavigate={onNavigate}/>
 <main className="onece-v2-workspace-main">
 {view==='library'?<EmptyLibrary onUpload={()=>onNavigate('upload')}/>:
 view==='upload'?<UploadView/>:
 <section className="onece-workspace-placeholder"><h1>{view==='account'?'Settings':view==='profile'?'Public Profile':'Discover'}</h1><p>{view==='profile'?'Public profile publishing is not yet enabled in v2.':view==='account'?'Account settings are not yet available in v2.':'Discover is not yet available in v2.'}</p></section>}
 </main>
 {view==='library'&&<div className="onece-player-dock" aria-label="Add audio"><button type="button" className="onece-global-player" style={{display:'flex',justifyContent:'center',gap:10,width:'fit-content',maxWidth:'100%',marginInline:'auto',padding:'7px 26px',color:'inherit',font:'inherit',fontSize:13,cursor:'pointer'}} onClick={()=>onNavigate('upload')}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Add file</span></button></div>}
 </div>;
}
