import React,{useState} from 'react';
import {Bookmark,Users,Share2,Eye,EyeOff,Link2,ListPlus,FolderPlus,Pencil,Image as ImageIcon,Download,Layers,Trash2,ChevronRight,Play,Pause} from 'lucide-react';
import './public-profile-v2.css';

function CatalogLibraryIcon({size=17}:{size?:number}){
 // Same SVG paths and styling as the Library navigation HomeMark.
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4v16M9 4v16M14 4l4 16"/></svg>;
}
function PlayIcon(){return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m8 5 12 7-12 7Z"/></svg>}
function PauseIcon(){return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>}
const api=import.meta.env.VITE_API_URL;
type PublicProject={id:string;kind:'beat'|'pack';owner_id:number;title:string;cover_file_id:number|null;track_count:number|null;published_at:string};
function ProjectCover({project,currentUserId}:{project:PublicProject;currentUserId?:number}){
 const [src,setSrc]=useState('');
 React.useEffect(()=>{
  setSrc('');
  if(!project.cover_file_id||!api)return;
  let alive=true,url='';
  const owner=String(currentUserId||'')===String(project.owner_id);
  const routes=owner
   ? ['/api/library/files/cover/'+project.cover_file_id,'/api/public/cover/'+project.owner_id+'/'+project.cover_file_id]
   : ['/api/public/cover/'+project.owner_id+'/'+project.cover_file_id];
  (async()=>{
   for(const route of routes){
    try{
     const response=await fetch(api+route,{credentials:'include'});
     if(!response.ok)continue;
     const blob=await response.blob();
     if(!blob.type.startsWith('image/'))continue;
     url=URL.createObjectURL(blob);
     if(alive)setSrc(url);else URL.revokeObjectURL(url);
     return;
    }catch{ /* try alternate authorized route */ }
   }
  })();
  return()=>{alive=false;if(url)URL.revokeObjectURL(url)};
 },[project.cover_file_id,project.owner_id,currentUserId]);
 return <div className="onece-profile-project-cover">{src?<img src={src} alt=""/>:<span>{project.title.charAt(0).toUpperCase()}</span>}</div>;
}
type ProfileTab='catalog'|'saves'|'following';
export default function PublicProfileV2({user,onSettings,profileId,onPlayProject}:{user:any;onSettings:()=>void;profileId?:string;onPlayProject?:(kind:'beat'|'pack',id:string)=>void}){
 const [tab,setTab]=useState<ProfileTab>('catalog');
 const [projects,setProjects]=useState<{catalog:PublicProject[];saves:PublicProject[]}>({catalog:[],saves:[]});
 const [saved,setSaved]=useState<Set<string>>(new Set());
 const [published,setPublished]=useState<Set<string>>(new Set());
 const [activeProject,setActiveProject]=useState<string|null>(null);
 const [menu,setMenu]=useState<{project:PublicProject;x:number;y:number}|null>(null);
 const [profileUser,setProfileUser]=useState<any>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const targetId=profileId||String(user?.id||'');
 const isOwner=!profileId||String(user?.id)===profileId;
 React.useEffect(()=>{
  if(!api||!targetId){setLoading(false);return;}
  const controller=new AbortController();
  setLoading(true);setError('');
  Promise.all([
   fetch(api+'/api/public/profile/'+targetId,{credentials:'include',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('Unable to load profile');return r.json()}),
   user?.id?fetch(api+'/api/public/mine',{credentials:'include',signal:controller.signal}).then(r=>r.ok?r.json():{saved:[]}):Promise.resolve({saved:[]})
  ]).then(([result,mine])=>{
   setProjects({catalog:result.catalog||[],saves:result.saves||[]});
   setProfileUser(result.profile||null);
   setPublished(new Set((mine.published||[]).map((p:{kind:string;id:string})=>p.kind+':'+p.id)));
   setSaved(new Set((mine.saved||[]).map((p:{owner_id:number;kind:string;id:string})=>p.owner_id+':'+p.kind+':'+p.id)));
  }).catch(e=>{if(e.name!=='AbortError')setError(e.message||'Unable to load profile')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[targetId,user?.id,tab]);
 const toggleSave=async(project:PublicProject)=>{
  const key=project.owner_id+':'+project.kind+':'+project.id;
  const already=saved.has(key);
  try{
   const response=await fetch(api+'/api/public/save/'+project.owner_id+'/'+project.kind+'/'+project.id,{method:already?'DELETE':'POST',credentials:'include'});
   if(!response.ok)throw Error((await response.json().catch(()=>({}))).error||'Unable to save');
   setSaved(prev=>{const next=new Set(prev);if(already)next.delete(key);else next.add(key);return next});
   if(isOwner)setProjects(prev=>({...prev,saves:already?prev.saves.filter(p=>p.owner_id+':'+p.kind+':'+p.id!==key):[project,...prev.saves.filter(p=>p.owner_id+':'+p.kind+':'+p.id!==key)]}));
  }catch(e){setError(e instanceof Error?e.message:'Unable to save')}
 };

 const ownerOf=(project:PublicProject)=>!!user?.id&&String(user.id)===String(project.owner_id);
 const publishProject=async(project:PublicProject)=>{
  setMenu(null);setError('');
  const key=project.kind+':'+project.id,already=published.has(key);
  try{
   const response=await fetch(api+'/api/public/publish/'+project.kind+'/'+project.id,{method:already?'DELETE':'POST',credentials:'include'});
   if(!response.ok)throw Error((await response.json().catch(()=>({}))).error||'Unable to change publication');
   setPublished(previous=>{const next=new Set(previous);if(already)next.delete(key);else next.add(key);return next});
   setProjects(previous=>({...previous,catalog:already?previous.catalog.filter(p=>p.kind+':'+p.id!==key):previous.catalog}));
  }catch(e){setError(e instanceof Error?e.message:'Unable to change publication')}
 };
 const copyProjectLink=async(project:PublicProject)=>{
  setMenu(null);setError('');
  try{
   const response=await fetch(api+'/api/public/share/'+project.kind+'/'+project.id,{method:'POST',credentials:'include'});
   if(!response.ok)throw Error((await response.json().catch(()=>({}))).error||'Unable to share project');
   const result=await response.json();
   await navigator.clipboard.writeText(window.location.origin+'/shared/'+result.token);
  }catch(e){setError(e instanceof Error?e.message:'Unable to copy link')}
 };
 React.useEffect(()=>{
  if(!menu)return;
  const dismiss=()=>setMenu(null);
  window.addEventListener('pointerdown',dismiss);
  window.addEventListener('scroll',dismiss,true);
  window.addEventListener('keydown',dismiss);
  return()=>{window.removeEventListener('pointerdown',dismiss);window.removeEventListener('scroll',dismiss,true);window.removeEventListener('keydown',dismiss)};
 },[menu]);
 const shownUser=profileId?profileUser:user;
 const name=String(shownUser?.displayName||shownUser?.name||shownUser?.username||'Profile');
 const handle=String(shownUser?.username||shownUser?.handle||'');
 const picture=shownUser?.customPicture||shownUser?.custom_picture||shownUser?.picture||'';
 const tabs:{id:ProfileTab;label:string;icon:React.ReactNode}[]=[
  {id:'catalog',label:'Catalog',icon:<CatalogLibraryIcon/>},
  {id:'saves',label:'Saves',icon:<Bookmark size={16}/>},
  {id:'following',label:'Following',icon:<Users size={16}/>}
 ];
 return <section className="onece-public-profile" aria-label="Public profile">
  <div className="onece-profile-top">
   <div className="onece-profile-avatar">{picture?<img src={picture} alt="" referrerPolicy="no-referrer"/>:<span>{name.slice(0,1).toUpperCase()}</span>}</div>
   <div className="onece-profile-name">
    <h1>{handle?'@'+handle.replace(/^@/,''):name}</h1>
    <div className="onece-profile-actions">
     <button type="button" onClick={()=>{if(navigator.share)void navigator.share({title:name,url:window.location.origin+'/u/'+targetId}).catch(()=>{});else if(navigator.clipboard)void navigator.clipboard.writeText(window.location.origin+'/u/'+targetId)}} aria-label="Share profile" title="Share profile"><Share2 size={15}/></button>
    </div>
   </div>
   {handle&&name.toLowerCase()!==handle.toLowerCase()&&<p className="onece-profile-display-name">{name}</p>}
  </div>
  <nav className="onece-profile-tabs" role="tablist" aria-label="Profile sections">
   {tabs.map(t=><button key={t.id} id={'onece-tab-'+t.id} type="button" role="tab" aria-selected={tab===t.id} aria-controls="onece-profile-tab-panel" className={tab===t.id?'is-active':''} onClick={()=>setTab(t.id)} aria-label={t.label} title={t.label}>{t.icon}</button>)}
  </nav>
  <div className="onece-profile-panel" id="onece-profile-tab-panel" role="tabpanel" aria-labelledby={'onece-tab-'+tab}>
   {error&&<p role="alert" className="onece-profile-status">{error}</p>}
   {loading?<p className="onece-profile-status">Loading profile…</p>:tab==='following'?
    <div className="onece-profile-empty"><Users size={27}/><h2>Not following anyone yet</h2><p>Artists you follow will appear here once following is available.</p></div>:
    (tab==='catalog'?projects.catalog:projects.saves).length?
    <div className="onece-profile-projects">{(tab==='catalog'?projects.catalog:projects.saves).map(project=>{
     const key=project.owner_id+':'+project.kind+':'+project.id;
     return <article className="onece-profile-project" key={key} onContextMenu={event=>{event.preventDefault();setMenu({project,x:event.clientX,y:event.clientY})}}>
      <div className="onece-profile-project-art"><ProjectCover project={project} currentUserId={user?.id}/>{onPlayProject&&ownerOf(project)&&<button type="button" className="v2-card-play onece-profile-project-play" aria-label={activeProject===key?'Pause project':'Play project'} title={activeProject===key?'Pause':'Play'} onClick={()=>{onPlayProject(project.kind,project.id);setActiveProject(activeProject===key?null:key)}}>{activeProject===key?<PauseIcon/>:<PlayIcon/>}</button>}</div>
      <div className="onece-profile-project-info"><strong>{project.title}</strong><span>{project.kind==='pack'?(project.track_count||0)+' beats':'Beat'}</span></div>
     </article>;
    })}</div>:
    tab==='catalog'?<div className="onece-profile-empty"><CatalogLibraryIcon size={27}/><h2>No public releases yet</h2><p>Beats and packs will appear here when published. Private Library files are never displayed automatically.</p></div>:
    <div className="onece-profile-empty"><Bookmark size={27}/><h2>No saves yet</h2><p>Saved projects will appear here.</p></div>}
  </div>
  {menu&&<div className="onece-profile-context-menu" role="menu" aria-label={'Actions for '+menu.project.title} style={{position:'fixed',left:Math.max(8,Math.min(menu.x,window.innerWidth-248)),top:Math.max(8,Math.min(menu.y,window.innerHeight-430)),zIndex:1000}} onPointerDown={e=>e.stopPropagation()} onContextMenu={e=>e.preventDefault()}>
   {ownerOf(menu.project)&&<><button type="button" role="menuitem" onClick={()=>void publishProject(menu.project)}>{published.has(menu.project.kind+':'+menu.project.id)?<EyeOff size={17}/>:<Eye size={17}/>}<span>{published.has(menu.project.kind+':'+menu.project.id)?'Unpublish':'Publish'}</span></button><div className="onece-profile-context-separator"/></>}
   <button type="button" role="menuitem" onClick={()=>{const project=menu.project;setMenu(null);void toggleSave(project)}}><Bookmark size={17}/><span>{saved.has(menu.project.owner_id+':'+menu.project.kind+':'+menu.project.id)?'Unsave':'Save'}</span></button>
   {ownerOf(menu.project)&&<button type="button" role="menuitem" onClick={()=>void copyProjectLink(menu.project)}><Link2 size={17}/><span>Copy link</span></button>}
   <button type="button" role="menuitem" disabled title="Public profile playback queue is not yet connected"><ListPlus size={17}/><span>Add to queue</span></button>
   {ownerOf(menu.project)&&<><button type="button" role="menuitem" disabled title="Collections are not yet connected"><FolderPlus size={17}/><span>Add to...</span><ChevronRight size={15}/></button>
   <div className="onece-profile-context-separator"/>
   <button type="button" role="menuitem" disabled title="Rename is not yet connected"><Pencil size={17}/><span>Rename</span></button>
   <button type="button" role="menuitem" disabled title="Changing covers is not yet connected"><ImageIcon size={17}/><span>Change cover</span></button>
   <button type="button" role="menuitem" disabled title="Download is not yet connected"><Download size={17}/><span>{menu.project.kind==='pack'?'Download ZIP':'Download MP3'}</span></button>
   {menu.project.kind==='beat'&&<button type="button" role="menuitem" disabled title="Stems management is not yet connected"><Layers size={17}/><span>Stems</span></button>}
   <div className="onece-profile-context-separator"/>
   <button type="button" role="menuitem" disabled title="Deletion is not yet connected"><Trash2 size={17}/><span>Delete {menu.project.kind}</span></button></>}
  </div>}
 </section>
}
