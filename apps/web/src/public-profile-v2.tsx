import React,{useState} from 'react';
import {Bookmark,Users,Share2} from 'lucide-react';
import './public-profile-v2.css';

function CatalogLibraryIcon({size=17}:{size?:number}){
 // Same SVG paths and styling as the Library navigation HomeMark.
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4v16M9 4v16M14 4l4 16"/></svg>;
}
const api=import.meta.env.VITE_API_URL;
type PublicProject={id:string;kind:'beat'|'pack';owner_id:number;title:string;cover_file_id:number|null;track_count:number|null;published_at:string};
function ProjectCover({project}:{project:PublicProject}){
 const [src,setSrc]=useState('');
 React.useEffect(()=>{
  if(!project.cover_file_id||!api)return;
  let alive=true,url='';
  fetch(api+'/api/public/cover/'+project.owner_id+'/'+project.cover_file_id).then(r=>{if(!r.ok)throw Error('Cover unavailable');return r.blob()}).then(blob=>{url=URL.createObjectURL(blob);if(alive)setSrc(url);else URL.revokeObjectURL(url)}).catch(()=>{});
  return()=>{alive=false;if(url)URL.revokeObjectURL(url)};
 },[project.cover_file_id,project.owner_id]);
 return <div className="onece-profile-project-cover">{src?<img src={src} alt=""/>:<span>{project.title.charAt(0).toUpperCase()}</span>}</div>;
}
type ProfileTab='catalog'|'saves'|'following';
export default function PublicProfileV2({user,onSettings,profileId}:{user:any;onSettings:()=>void;profileId?:string}){
 const [tab,setTab]=useState<ProfileTab>('catalog');
 const [projects,setProjects]=useState<{catalog:PublicProject[];saves:PublicProject[]}>({catalog:[],saves:[]});
 const [saved,setSaved]=useState<Set<string>>(new Set());
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
   fetch(api+'/api/public/profile/'+targetId,{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('Unable to load profile');return r.json()}),
   user?.id?fetch(api+'/api/public/mine',{credentials:'include',signal:controller.signal}).then(r=>r.ok?r.json():{saved:[]}):Promise.resolve({saved:[]})
  ]).then(([result,mine])=>{
   setProjects({catalog:result.catalog||[],saves:result.saves||[]});
   setProfileUser(result.profile||null);
   setSaved(new Set((mine.saved||[]).map((p:{owner_id:number;kind:string;id:string})=>p.owner_id+':'+p.kind+':'+p.id)));
  }).catch(e=>{if(e.name!=='AbortError')setError(e.message||'Unable to load profile')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[targetId,user?.id]);
 const toggleSave=async(project:PublicProject)=>{
  const key=project.owner_id+':'+project.kind+':'+project.id;
  const already=saved.has(key);
  try{
   const response=await fetch(api+'/api/public/save/'+project.owner_id+'/'+project.kind+'/'+project.id,{method:already?'DELETE':'POST',credentials:'include'});
   if(!response.ok)throw Error((await response.json().catch(()=>({}))).error||'Unable to save');
   setSaved(prev=>{const next=new Set(prev);if(already)next.delete(key);else next.add(key);return next});
   if(already&&tab==='saves'&&isOwner)setProjects(prev=>({...prev,saves:prev.saves.filter(p=>p.owner_id+':'+p.kind+':'+p.id!==key)}));
  }catch(e){setError(e instanceof Error?e.message:'Unable to save')}
 };

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
     <button type="button" onClick={()=>{if(navigator.share)void navigator.share({title:name,url:window.location.href}).catch(()=>{});else if(navigator.clipboard)void navigator.clipboard.writeText(window.location.href)}} aria-label="Share profile" title="Share profile"><Share2 size={15}/></button>
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
     return <article className="onece-profile-project" key={key}>
      <ProjectCover project={project}/>
      <div className="onece-profile-project-info"><strong>{project.title}</strong><span>{project.kind==='pack'?(project.track_count||0)+' beats':'Beat'}</span></div>
      {user?.id&&<button type="button" className="onece-profile-project-save" aria-label={saved.has(key)?'Unsave '+project.title:'Save '+project.title} aria-pressed={saved.has(key)} title={saved.has(key)?'Unsave':'Save'} onClick={()=>void toggleSave(project)}><Bookmark size={17} fill={saved.has(key)?'currentColor':'none'}/></button>}
     </article>;
    })}</div>:
    tab==='catalog'?<div className="onece-profile-empty"><CatalogLibraryIcon size={27}/><h2>No public releases yet</h2><p>Beats and packs will appear here when published. Private Library files are never displayed automatically.</p></div>:
    <div className="onece-profile-empty"><Bookmark size={27}/><h2>No saves yet</h2><p>Saved projects will appear here.</p></div>}
  </div>
 </section>
}
