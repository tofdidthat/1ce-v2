import React,{useState} from 'react';
import {Bookmark,Users,Share2,Eye,EyeOff,Link2,ListPlus,FolderPlus,Pencil,Image as ImageIcon,Download,Layers,Trash2,ChevronRight,Play,Pause} from 'lucide-react';
import './public-profile-v2.css';
import ProjectContextMenuV2 from './project-context-menu-v2';
import ProjectCardV2 from './project-card-v2';
import {createProjectShareLinkV2} from './project-requests-v2';
import ProjectActionDialogV2,{type ContextProject,type ProjectAction,type ChangedProject} from './project-action-dialog-v2';
import {subscribeV2DataChanges,subscribeV2Resume} from './data-refresh-v2';
import useProjectFlagsV2 from './project-flags-v2';
import {profilePictureV2} from './profile-picture-v2';
import {normalizeProfileProjectsV2,normalizeLibraryProjectsV2,type ProfileProjectV2} from './project-read-v2';
import {savedProjectKeyV2} from './project-identity-v2';

function CatalogLibraryIcon({size=17}:{size?:number}){
 // Same SVG paths and styling as the Library navigation HomeMark.
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4v16M9 4v16M14 4l4 16"/></svg>;
}
const api=import.meta.env.VITE_API_URL;
type PublicProject=ProfileProjectV2;
type ProfileTab='catalog'|'saves'|'following';
export default function PublicProfileV2({user,onSettings,profileId,onPlayProject,playback}:{user:any;onSettings:()=>void;profileId?:string;onPlayProject?:(ownerId:number,kind:'beat'|'pack',id:string)=>void;playback?:{ownerId:number;kind:'beat'|'pack';id:string;playing:boolean}|null}){
 const [tab,setTab]=useState<ProfileTab>('catalog');
 const [projects,setProjects]=useState<{catalog:PublicProject[];saves:PublicProject[]}>({catalog:[],saves:[]});
 const {saved,published,status:flagsStatus,error:flagsError,refresh:retryFlags,toggleSaved,togglePublished}=useProjectFlagsV2();
 const [menu,setMenu]=useState<{project:PublicProject;x:number;y:number}|null>(null);
 const [actionDialog,setActionDialog]=useState<{project:ContextProject;action:ProjectAction}|null>(null);
 const [ownerPacks,setOwnerPacks]=useState<{id:string;title:string;track_count:number}[]>([]);
 const [profileUser,setProfileUser]=useState<any>(null);
 const [loadState,setLoadState]=useState<{key:string;status:'loading'|'ready'|'error'}>({key:'',status:'loading'});
 const [error,setError]=useState('');
 const [refreshRevision,setRefreshRevision]=useState(0);
 const targetId=profileId||String(user?.id||'');
 const requestKey=String(user?.id||'anonymous')+':'+targetId;
 const profileStatus=loadState.key===requestKey?loadState.status:'loading';
 const visibleProjects=profileStatus==='ready'?projects:{catalog:[],saves:[]};
 const visibleProfileUser=profileStatus==='ready'?profileUser:null;
 const isOwner=!profileId||String(user?.id)===String(visibleProfileUser?.id)||Boolean(user?.username&&user.username===profileId);
 React.useEffect(()=>subscribeV2DataChanges(['library','saves','publications','shares','identity'],
  ()=>setRefreshRevision(v=>v+1)),[targetId,user?.id]);
 React.useEffect(()=>subscribeV2Resume(()=>setRefreshRevision(v=>v+1)),[targetId,user?.id]);
 React.useEffect(()=>{
  if(!api||!targetId){
   setLoadState({key:requestKey,status:'error'});setError('Profile API is not configured');return;
  }
  const controller=new AbortController();
  setLoadState({key:requestKey,status:'loading'});setError('');
  fetch(api+'/api/public/profile/'+targetId,{credentials:'include',signal:controller.signal,cache:'no-store'})
    .then(async response=>{if(!response.ok)throw Error('Unable to load profile');return response.json()})
    .then(result=>{
     if(controller.signal.aborted)return;
     setProjects(normalizeProfileProjectsV2(result));
     setProfileUser(result.profile||null);
     setLoadState({key:requestKey,status:'ready'});
    }).catch(e=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:'Unable to load profile');setLoadState({key:requestKey,status:'error'});}});
   return()=>controller.abort();
 },[requestKey,refreshRevision]);
 const toggleSave=async(project:PublicProject)=>{
  const key=savedProjectKeyV2(project.owner_id,project.kind,project.id);
  const already=saved.has(key);
  try{
   await toggleSaved(project.owner_id,project.kind,project.id);
   if(isOwner)setProjects(prev=>({...prev,saves:already?prev.saves.filter(p=>savedProjectKeyV2(p.owner_id,p.kind,p.id)!==key):[project,...prev.saves.filter(p=>savedProjectKeyV2(p.owner_id,p.kind,p.id)!==key)]}));
  }catch(e){setError(e instanceof Error?e.message:'Unable to save')}
 };

 const ownerOf=(project:PublicProject)=>!!user?.id&&String(user.id)===String(project.owner_id);
 const showProjectAction=(action:ProjectAction,project:PublicProject)=>{
  if(!ownerOf(project))return;
  setMenu(null);
  setActionDialog({action,project:{kind:project.kind,id:project.id,title:project.title,cover_file_id:project.cover_file_id}});
  if(action==='add')void fetch(api+'/api/library/files/items',{credentials:'include'}).then(r=>{if(!r.ok)throw Error('Unable to load packs');return r.json()}).then(data=>setOwnerPacks(normalizeLibraryProjectsV2(data,Number(user?.id)).packs)).catch(e=>setError(e instanceof Error?e.message:'Unable to load packs'));
 };
 const onProjectChanged=(change:ChangedProject)=>{
  setActionDialog(null);
  const matches=(p:PublicProject)=>p.id===change.source.id&&p.kind===change.source.kind&&ownerOf(p);
  if(change.action==='delete')setProjects(prev=>({catalog:prev.catalog.filter(p=>!matches(p)),saves:prev.saves.filter(p=>!matches(p))}));
  if(change.action==='rename'||change.action==='cover'){
   const update=(rows:PublicProject[])=>rows.map(p=>matches(p)?{...p,...(change.action==='rename'?{title:change.title!}:{cover_file_id:change.coverFileId??null})}:p);
   setProjects(prev=>({catalog:update(prev.catalog),saves:update(prev.saves)}));
  }
  setRefreshRevision(v=>v+1);
 };

 const publishProject=async(project:PublicProject)=>{
  setMenu(null);setError('');
  const key=project.kind+':'+project.id,already=published.has(key);
  try{
   await togglePublished(project.kind,project.id);
   setProjects(previous=>({...previous,catalog:already?previous.catalog.filter(p=>p.kind+':'+p.id!==key):previous.catalog}));
  }catch(e){setError(e instanceof Error?e.message:'Unable to change publication')}
 };
 const copyProjectLink=async(project:PublicProject)=>{
  setMenu(null);setError('');
  try{
   const url=await createProjectShareLinkV2(project.kind,project.id);
   await navigator.clipboard.writeText(url);
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
 const shownUser=profileId?visibleProfileUser:user;
 const name=String(shownUser?.displayName||shownUser?.name||shownUser?.username||'Profile');
 const handle=String(shownUser?.username||shownUser?.handle||'');
 const picture=profilePictureV2(shownUser);
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
     <button type="button" onClick={()=>{if(navigator.share)void navigator.share({title:name,url:window.location.origin+'/u/'+encodeURIComponent(handle||targetId)}).catch(()=>{});else if(navigator.clipboard)void navigator.clipboard.writeText(window.location.origin+'/u/'+encodeURIComponent(handle||targetId))}} aria-label="Share profile" title="Share profile"><Share2 size={15}/></button>
    </div>
   </div>
   {handle&&name.toLowerCase()!==handle.toLowerCase()&&<p className="onece-profile-display-name">{name}</p>}
  </div>
  <nav className="onece-profile-tabs" role="tablist" aria-label="Profile sections">
   {tabs.map(t=><button key={t.id} id={'onece-tab-'+t.id} type="button" role="tab" aria-selected={tab===t.id} aria-controls="onece-profile-tab-panel" className={tab===t.id?'is-active':''} onClick={()=>setTab(t.id)} aria-label={t.label} title={t.label}>{t.icon}</button>)}
  </nav>
  <div className="onece-profile-panel" id="onece-profile-tab-panel" role="tabpanel" aria-labelledby={'onece-tab-'+tab}>
   {error&&<p role="alert" className="onece-profile-status">{error}{profileStatus==='error'&&<button type="button" onClick={()=>setRefreshRevision(v=>v+1)}>Retry</button>}</p>}
   {flagsStatus==='loading'&&<p className="onece-profile-status">Loading Save and Publish actions…</p>}
   {flagsStatus==='error'&&<p role="alert" className="onece-profile-status">{flagsError}<button type="button" onClick={retryFlags}>Retry</button></p>}
   {profileStatus==='loading'?<p className="onece-profile-status">Loading profile…</p>:profileStatus==='error'?null:tab==='following'?
    <div className="onece-profile-empty"><Users size={27}/><h2>Not following anyone yet</h2><p>Artists you follow will appear here once following is available.</p></div>:
    (tab==='catalog'?visibleProjects.catalog:visibleProjects.saves).length?
    <div className="onece-profile-projects">{(tab==='catalog'?visibleProjects.catalog:visibleProjects.saves).map(project=>{
     const key=savedProjectKeyV2(project.owner_id,project.kind,project.id);
     const isPlaying=!!playback&&playback.ownerId===project.owner_id&&playback.kind===project.kind&&playback.id===project.id&&playback.playing;
     return <ProjectCardV2 key={key} variant="profile" project={project} ownerId={project.owner_id}
       secondary={project.kind==='pack'?(project.track_count||0)+' beats':'Beat'} playing={isPlaying}
       onContextMenu={event=>{event.preventDefault();setMenu({project,x:event.clientX,y:event.clientY})}}
       onPlay={onPlayProject?()=>onPlayProject(project.owner_id,project.kind,project.id):undefined}/>;
    })}</div>:
    tab==='catalog'?<div className="onece-profile-empty"><CatalogLibraryIcon size={27}/><h2>No public releases yet</h2><p>Beats and packs will appear here when published. Private Library files are never displayed automatically.</p></div>:
    <div className="onece-profile-empty"><Bookmark size={27}/><h2>No saves yet</h2><p>Saved projects will appear here.</p></div>}
  </div>
  {menu&&<ProjectContextMenuV2 project={menu.project} x={menu.x} y={menu.y} owner={ownerOf(menu.project)} published={published.has(menu.project.kind+':'+menu.project.id)} saved={saved.has(menu.project.owner_id+':'+menu.project.kind+':'+menu.project.id)}
   onPublish={flagsStatus==='ready'?()=>void publishProject(menu.project):undefined} onSave={flagsStatus==='ready'?()=>{const project=menu.project;setMenu(null);void toggleSave(project)}:undefined} onShare={()=>void copyProjectLink(menu.project)} onAction={action=>showProjectAction(action,menu.project)}/>}
  {actionDialog&&<ProjectActionDialogV2 key={actionDialog.action+':'+actionDialog.project.id} project={actionDialog.project} action={actionDialog.action} packs={ownerPacks} userId={user?.id} onClose={()=>setActionDialog(null)} onChanged={onProjectChanged}/>}
  </section>
}
