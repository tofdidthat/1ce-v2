import React,{useState} from 'react';
import {Bookmark,Users,UserRoundPlus,UserRoundCheck,ChevronLeft,Eye,EyeOff,Link2,ListPlus,FolderPlus,Pencil,Image as ImageIcon,Download,Layers,Trash2,ChevronRight,Play,Pause} from 'lucide-react';
import './public-profile-v2.css';
import CopyLinkIconV2 from './copy-link-icon-v2';
import ProjectContextMenuV2 from './project-context-menu-v2';
import ProjectCardV2 from './project-card-v2';
import {createProjectShareLinkV2} from './project-requests-v2';
import {fetchPlayableProjectV2,downloadAuthorizedMp3V2,publicProjectLinkV2,type PlayableTrackV2} from './public-project-actions-v2';
import ProjectActionDialogV2,{type ContextProject,type ProjectAction,type ChangedProject} from './project-action-dialog-v2';
import {subscribeV2DataChanges,subscribeV2Resume,notifyV2DataChanged} from './data-refresh-v2';
import useProjectFlagsV2 from './project-flags-v2';
import {profilePictureV2} from './profile-picture-v2';
import {normalizeProfileProjectsV2,normalizeLibraryProjectsV2,type ProfileProjectV2} from './project-read-v2';
import {savedProjectKeyV2} from './project-identity-v2';
import {getProfileFollowsV2,setProfileFollowV2,type ProfileFollowsV2} from './profile-follows-v2';
import EditProfilePanelV2 from './edit-profile-panel-v2';
import {ProfileSocialLinksV2} from './profile-social-links-v2';

function CatalogLibraryIcon({size=17}:{size?:number}){
 // Dedicated Catalog icon; do not swap with the house used for Home navigation.
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4v16M9 4v16M14 4l4 16"/></svg>;
}
const api=import.meta.env.VITE_API_URL;
type PublicProject=ProfileProjectV2;
type ProfileTab='catalog'|'saves'|'following';
export default function PublicProfileV2({user,onIdentityUpdated,onBack,onLogin,onOpenProfile,profileId,onPlayProject,onQueueProject,playback,active=true}:{user:any;active?:boolean;onIdentityUpdated:(updated:any)=>void;onBack:()=>void;onLogin:()=>void;onOpenProfile:(identifier:string)=>void;profileId?:string;onPlayProject?:(ownerId:number,kind:'beat'|'pack',id:string)=>void;onQueueProject?:(ownerId:number,kind:'beat'|'pack',id:string)=>void;playback?:{ownerId:number;kind:'beat'|'pack';id:string;playing:boolean}|null}){
 const [tab,setTab]=useState<ProfileTab>('catalog');
 const [editorOpen,setEditorOpen]=useState(false);
 const [projects,setProjects]=useState<{catalog:PublicProject[];saves:PublicProject[]}>({catalog:[],saves:[]});
 const {saved,published,status:flagsStatus,error:flagsError,refresh:retryFlags,toggleSaved,togglePublished}=useProjectFlagsV2();
 const [menu,setMenu]=useState<{project:PublicProject;x:number;y:number}|null>(null);
 const [downloadPicker,setDownloadPicker]=useState<{project:PublicProject;tracks:PlayableTrackV2[];busy:boolean;error:string}|null>(null);
 const [downloadBusy,setDownloadBusy]=useState(false);
 const downloadRequest=React.useRef<AbortController|null>(null);
 const [actionDialog,setActionDialog]=useState<{project:ContextProject;action:ProjectAction}|null>(null);
 const [ownerPacks,setOwnerPacks]=useState<{id:string;title:string;track_count:number}[]>([]);
 const [profileUser,setProfileUser]=useState<any>(null);
 const lastVerifiedProfileKey=React.useRef('');
 const [loadState,setLoadState]=useState<{key:string;status:'loading'|'ready'|'error'}>({key:'',status:'loading'});
 const [error,setError]=useState('');
 const [refreshRevision,setRefreshRevision]=useState(0);
 const [followRevision,setFollowRevision]=useState(0);
 const previouslyActive=React.useRef(active);
 React.useEffect(()=>{
  if(active&&!previouslyActive.current){setRefreshRevision(value=>value+1);setFollowRevision(value=>value+1);}
  previouslyActive.current=active;
 },[active]);
 const [followState,setFollowState]=useState<{key:string;status:'loading'|'ready'|'error';data:ProfileFollowsV2|null}>({key:'',status:'loading',data:null});
 const [followError,setFollowError]=useState('');
 const [followBusy,setFollowBusy]=useState(false);
 const [copyStatus,setCopyStatus]=useState('');
 const currentFollowRequest=React.useRef('');
 const targetId=profileId||String(user?.id||'');
 const requestKey=String(user?.id||'anonymous')+':'+targetId;
 const profileStatus=loadState.key===requestKey?loadState.status:'loading';
 // Revalidation must not close the owner's open editor, but old profile
 // data must never leak across a different viewer or target profile.
 const sameVerifiedProfile=lastVerifiedProfileKey.current===requestKey;
 const visibleProjects=(profileStatus==='ready'||sameVerifiedProfile)?projects:{catalog:[],saves:[]};
 const visibleProfileUser=(profileStatus==='ready'||sameVerifiedProfile)?profileUser:null;
 const isOwner=!!user?.id&&(!profileId||String(user.id)===String(visibleProfileUser?.id));
 const resolvedTargetId=profileStatus==='ready'&&Number.isSafeInteger(Number(visibleProfileUser?.id))?Number(visibleProfileUser?.id):null;
 const followKey=requestKey+':'+String(resolvedTargetId??'');
 currentFollowRequest.current=followKey;
 const followStatus=followState.key===followKey?followState.status:'loading';
 const followData=followState.key===followKey?followState.data:null;
 React.useEffect(()=>{
  if(!active)return;
  return subscribeV2DataChanges(['library','saves','publications','shares','identity'],
   ()=>setRefreshRevision(v=>v+1));
 },[active,targetId,user?.id]);
 React.useEffect(()=>{
  if(!active)return;
  return subscribeV2Resume(()=>setRefreshRevision(v=>v+1));
 },[active,targetId,user?.id]);
 React.useEffect(()=>setEditorOpen(false),[targetId,user?.id]);
 React.useEffect(()=>{downloadRequest.current?.abort();setDownloadPicker(null);setDownloadBusy(false);},[targetId,user?.id]);
 React.useEffect(()=>{
  if(active)return;
  setMenu(null);setEditorOpen(false);setDownloadPicker(null);
  downloadRequest.current?.abort();
 },[active]);
 // Stable public profile project links do not mint grants. Query only navigates
 // to a card already returned by the existing authorized Catalog request.
 React.useEffect(()=>{
  const project=new URLSearchParams(window.location.search).get('project');
  if(!active||!project||!visibleProjects.catalog.some(p=>p.kind+':'+p.id===project)||profileStatus!=='ready')return;
  setTab('catalog');
  const element=visibleProjects.catalog.find(p=>p.kind+':'+p.id===project);
  if(!element)return;
  const frame=window.requestAnimationFrame(()=>document.getElementById('onece-project-'+element.kind+'-'+element.id)?.scrollIntoView({block:'center'}));
  return()=>window.cancelAnimationFrame(frame);
 },[active,profileStatus,visibleProjects.catalog]);
 React.useEffect(()=>{
  if(!active)return;
  return subscribeV2DataChanges(['follows'],()=>setFollowRevision(v=>v+1),user?.id);
 },[active,targetId,user?.id]);
 React.useEffect(()=>{
  if(!active)return;
  return subscribeV2Resume(()=>setFollowRevision(v=>v+1));
 },[active,targetId,user?.id]);
 React.useEffect(()=>{setFollowBusy(false);setCopyStatus('');},[followKey]);
 React.useEffect(()=>{
  if(!api||!targetId){
   setLoadState({key:requestKey,status:'error'});setError('Profile API is not configured');return;
  }
  const controller=new AbortController();
  setLoadState({key:requestKey,status:'loading'});setError('');
  fetch(api+'/api/public/profile/'+targetId,{credentials:'include',signal:controller.signal,cache:'no-store'})
    .then(async response=>{
     if(!response.ok){
      // Never keep previously authorized private cards if access is revoked.
      if(!controller.signal.aborted&&[401,403,404].includes(response.status)){
       lastVerifiedProfileKey.current='';setProjects({catalog:[],saves:[]});setProfileUser(null);
      }
      throw Error('Unable to load profile');
     }
     return response.json();
    })
    .then(result=>{
     if(controller.signal.aborted)return;
     lastVerifiedProfileKey.current=requestKey;
     setProjects(normalizeProfileProjectsV2(result));
     setProfileUser(result.profile||null);
     setLoadState({key:requestKey,status:'ready'});
    }).catch(e=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:'Unable to load profile');setLoadState({key:requestKey,status:'error'});}});
   return()=>controller.abort();
 },[requestKey,refreshRevision]);
 React.useEffect(()=>{
  if(!resolvedTargetId){setFollowState({key:followKey,status:'loading',data:null});return;}
  const controller=new AbortController();
  setFollowState(previous=>({key:followKey,status:'loading',data:previous.key===followKey?previous.data:null}));setFollowError('');
  void getProfileFollowsV2(resolvedTargetId,controller.signal).then(data=>{
   if(!controller.signal.aborted)setFollowState({key:followKey,status:'ready',data});
  }).catch(caught=>{
   if(!controller.signal.aborted){
    setFollowState({key:followKey,status:'error',data:null});
    setFollowError(caught instanceof Error?caught.message:'Unable to load following');
   }
  });
  return()=>controller.abort();
 },[followKey,followRevision]);
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
 const changeFollow=async()=>{
  if(!user?.id){onLogin();return;}
  if(!resolvedTargetId||isOwner||followStatus!=='ready'||!followData||followBusy)return;
  const key=followKey;
  setFollowBusy(true);setFollowError('');
  try{
   const result=await setProfileFollowV2(resolvedTargetId,followData.viewerFollows);
   if(currentFollowRequest.current===key){
    setFollowState(previous=>previous.key===key&&previous.data?
     {...previous,data:{...previous.data,viewerFollows:result.viewerFollows,followersCount:result.followersCount}}:previous);
   }
   notifyV2DataChanged(['follows'],Number(user.id));
  }catch(caught){
   if(currentFollowRequest.current===key)setFollowError(caught instanceof Error?caught.message:'Unable to update follow');
  }finally{if(currentFollowRequest.current===key)setFollowBusy(false);}
 };
 const copyProfileLink=async()=>{
  const identifier=String(visibleProfileUser?.username||visibleProfileUser?.id||user?.username||user?.id||targetId);
  const url=window.location.origin+'/u/'+encodeURIComponent(identifier);
  try{await navigator.clipboard.writeText(url);setCopyStatus('Link copied');}
  catch{setCopyStatus('Could not copy the profile link');}
 };
 const copyProjectLink=async(project:PublicProject)=>{
  setMenu(null);setError('');
  try{
   // A visitor cannot mint someone else's private share grant.
   // On a public profile use the existing public URL with a project selector.
   const url=ownerOf(project)
    ?await createProjectShareLinkV2(project.kind,project.id)
    :publicProjectLinkV2(window.location.origin,project.owner_id,project.kind,project.id);
   await navigator.clipboard.writeText(url);
  }catch(e){setError(e instanceof Error?e.message:'Unable to copy link')}
 };
 const beginDownload=async(project:PublicProject)=>{
  if(downloadBusy)return;
  setMenu(null);setError('');setDownloadBusy(true);
  downloadRequest.current?.abort();
  const controller=new AbortController();downloadRequest.current=controller;
  try{
   const manifest=await fetchPlayableProjectV2(project.owner_id,project.kind,project.id,controller.signal);
   if(controller.signal.aborted)return;
   if(project.kind==='pack'){
    setDownloadPicker({project,tracks:manifest.tracks,busy:false,error:''});
   }else{
    await downloadAuthorizedMp3V2(manifest.tracks[0],controller.signal);
   }
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Unable to download MP3');}
  finally{if(downloadRequest.current===controller){setDownloadBusy(false);downloadRequest.current=null;}}
 };
 const downloadPackTrack=async(track:PlayableTrackV2)=>{
  if(downloadBusy||!downloadPicker)return;
  setDownloadBusy(true);
  setDownloadPicker(previous=>previous?{...previous,busy:true,error:''}:previous);
  const controller=new AbortController();downloadRequest.current=controller;
  try{
   await downloadAuthorizedMp3V2(track,controller.signal);
  }catch(e){
   if(!controller.signal.aborted)setDownloadPicker(previous=>previous?{...previous,error:e instanceof Error?e.message:'Unable to download MP3'}:previous);
  }finally{
   if(downloadRequest.current===controller){downloadRequest.current=null;setDownloadBusy(false);}
   setDownloadPicker(previous=>previous?{...previous,busy:false}:previous);
  }
 };
 React.useEffect(()=>{
  if(!menu)return;
  const dismiss=()=>setMenu(null);
  window.addEventListener('pointerdown',dismiss);
  window.addEventListener('scroll',dismiss,true);
  window.addEventListener('keydown',dismiss);
  return()=>{window.removeEventListener('pointerdown',dismiss);window.removeEventListener('scroll',dismiss,true);window.removeEventListener('keydown',dismiss)};
 },[menu]);
 const shownUser=visibleProfileUser||user;
 const name=String(shownUser?.displayName||shownUser?.name||shownUser?.username||'Profile');
 const handle=String(shownUser?.username||shownUser?.handle||'');
 const picture=profilePictureV2(shownUser);
 const tabs:{id:ProfileTab;label:string;icon:React.ReactNode}[]=[
  {id:'catalog',label:'Catalog',icon:<CatalogLibraryIcon/>},
  {id:'saves',label:'Saves',icon:<Bookmark size={16}/>},
  {id:'following',label:'Following',icon:<Users size={16}/>}
 ];
 // Hide inactive cards without holding image cache leases; component state survives.
 if(!active)return null;
 return <section className="onece-public-profile" aria-label="Public profile">
  <header className="onece-workspace-header onece-profile-navbar" aria-label="Profile navigation">
   <div className="onece-workspace-brand">
    <button type="button" className="library-settings onece-profile-nav-back" aria-label="Go back" title="Back" onClick={onBack}><ChevronLeft size={20}/></button>
   </div>
   <div className="onece-workspace-actions onece-profile-nav-actions">
    {(profileStatus==='ready'||!profileId)&&(isOwner?
     <button type="button" className="library-settings onece-profile-nav-edit" aria-label="Edit profile" title="Edit profile" disabled={profileStatus!=='ready'} onClick={()=>setEditorOpen(true)}><Pencil size={22}/></button>:
     <button type="button" className="library-settings onece-profile-nav-follow" onClick={()=>void changeFollow()}
      disabled={!resolvedTargetId||followBusy||Boolean(user?.id&&followStatus!=='ready')}
      aria-label={followData?.viewerFollows?'Unfollow profile':'Follow profile'} aria-pressed={Boolean(followData?.viewerFollows)}>
      {followBusy?'…':followData?.viewerFollows?<UserRoundCheck size={22}/>:<UserRoundPlus size={22}/>}</button>)}
    <button type="button" className="library-settings onece-profile-nav-copy" aria-label="Copy profile link" title="Copy profile link" onClick={()=>void copyProfileLink()}><CopyLinkIconV2 size={22}/></button>
    {copyStatus&&<span className="onece-profile-copy-status" role="status">{copyStatus}</span>}
   </div>
  </header>
  <div className="onece-profile-top">
   <div className="onece-profile-avatar">{picture?<img src={picture} alt="" referrerPolicy="no-referrer"/>:<span>{name.slice(0,1).toUpperCase()}</span>}</div>
   <div className="onece-profile-name">
    <h1>{handle?handle.replace(/^@/,''):name}</h1>
   </div>
   <ProfileSocialLinksV2 compact links={Array.isArray(shownUser?.links)?shownUser.links:[]}/>
  </div>
  <nav className="onece-profile-tabs" role="tablist" aria-label="Profile sections">
   {tabs.map(t=><button key={t.id} id={'onece-tab-'+t.id} type="button" role="tab" aria-selected={tab===t.id} aria-controls="onece-profile-tab-panel" className={tab===t.id?'is-active':''} onClick={()=>setTab(t.id)} aria-label={t.label} title={t.label}>{t.icon}</button>)}
  </nav>
  <div className="onece-profile-panel" id="onece-profile-tab-panel" role="tabpanel" aria-labelledby={'onece-tab-'+tab}>
   {error&&<p role="alert" className="onece-profile-status">{error}{profileStatus==='error'&&<button type="button" onClick={()=>setRefreshRevision(v=>v+1)}>Retry</button>}</p>}
   {Boolean(user?.id)&&flagsStatus==='loading'&&<p className="onece-profile-status">Loading Save and Publish actions…</p>}
   {Boolean(user?.id)&&flagsStatus==='error'&&<p role="alert" className="onece-profile-status">{flagsError}<button type="button" onClick={retryFlags}>Retry</button></p>}
   {followError&&<p role="alert" className="onece-profile-status">{followError}<button type="button" onClick={()=>setFollowRevision(v=>v+1)}>Retry</button></p>}
   {profileStatus==='loading'&&!sameVerifiedProfile?<p className="onece-profile-status">Loading profile…</p>:profileStatus==='error'&&!sameVerifiedProfile?null:tab==='following'?
    followStatus==='loading'?<p className="onece-profile-status">Loading following…</p>:followStatus==='error'?null:
    followData?.followingUsers.length?
     <div className="onece-profile-following-list">{followData.followingUsers.map(person=>
      <button type="button" key={person.id} className="onece-profile-following-person" onClick={()=>onOpenProfile(person.username||String(person.id))}>
       <span className="onece-profile-following-avatar">{profilePictureV2(person)?<img src={profilePictureV2(person)} alt="" referrerPolicy="no-referrer"/>:String(person.name||person.username||'U').charAt(0).toUpperCase()}</span>
       <span className="onece-profile-following-identity"><strong>{person.username?'@'+person.username:person.name||'Artist'}</strong>{person.username&&person.name&&<small>{person.name}</small>}</span>
       <ChevronRight size={17}/>
      </button>)}</div>:
     <div className="onece-profile-empty"><Users size={27}/><h2>Not following anyone yet</h2><p>Artists followed by this profile will appear here.</p></div>:
    (tab==='catalog'?visibleProjects.catalog:visibleProjects.saves).length?
    <div className="onece-profile-projects">{(tab==='catalog'?visibleProjects.catalog:visibleProjects.saves).map(project=>{
     const key=savedProjectKeyV2(project.owner_id,project.kind,project.id);
     const isPlaying=!!playback&&playback.ownerId===project.owner_id&&playback.kind===project.kind&&playback.id===project.id&&playback.playing;
     return <ProjectCardV2 key={key} id={'onece-project-'+project.kind+'-'+project.id} variant="profile" project={project} ownerId={project.owner_id}
       secondary={project.kind==='pack'?(project.track_count||0)+' beats':'Beat'} playing={isPlaying}
       onContextMenu={event=>{event.preventDefault();setMenu({project,x:event.clientX,y:event.clientY})}}
       onPlay={onPlayProject?()=>onPlayProject(project.owner_id,project.kind,project.id):undefined}/>;
    })}</div>:
    tab==='catalog'?<div className="onece-profile-empty"><CatalogLibraryIcon size={27}/><h2>No public releases yet</h2><p>Beats and packs will appear here when published. Private projects in Home are never displayed automatically.</p></div>:
    <div className="onece-profile-empty"><Bookmark size={27}/><h2>No saves yet</h2><p>Saved projects will appear here.</p></div>}
  </div>
  {menu&&<ProjectContextMenuV2 project={menu.project} x={menu.x} y={menu.y} owner={ownerOf(menu.project)} published={published.has(menu.project.kind+':'+menu.project.id)} saved={saved.has(menu.project.owner_id+':'+menu.project.kind+':'+menu.project.id)}
   onPublish={flagsStatus==='ready'?()=>void publishProject(menu.project):undefined}
   onSave={flagsStatus==='ready'||!user?.id?()=>{const project=menu.project;setMenu(null);if(!user?.id){onLogin();return;}void toggleSave(project)}:undefined}
   onShare={()=>void copyProjectLink(menu.project)}
   onQueue={onQueueProject?()=>{const project=menu.project;setMenu(null);onQueueProject(project.owner_id,project.kind,project.id)}:undefined}
   onDownload={!ownerOf(menu.project)?()=>void beginDownload(menu.project):undefined}
   onAction={action=>showProjectAction(action,menu.project)}/>}
  {downloadPicker&&<div className="onece-profile-download-overlay" onMouseDown={event=>{if(event.target===event.currentTarget&&!downloadBusy)setDownloadPicker(null);}}>
   <section className="onece-profile-download-dialog" role="dialog" aria-modal="true" aria-label="Choose MP3 from pack">
    <header><h2>Download MP3</h2><button type="button" aria-label="Close MP3 picker" disabled={downloadBusy} onClick={()=>setDownloadPicker(null)}>×</button></header>
    <p>Choose a track from {downloadPicker.project.title}</p>
    <div className="onece-profile-download-tracks">{downloadPicker.tracks.map(track=>
     <button type="button" key={track.id} disabled={downloadBusy} onClick={()=>void downloadPackTrack(track)}>
      <span>{track.title}</span><Download size={17}/>
     </button>)}</div>
    {downloadPicker.error&&<p role="alert" className="onece-profile-download-error">{downloadPicker.error}</p>}
    {downloadPicker.busy&&<p role="status">Downloading MP3…</p>}
   </section>
  </div>}
  {actionDialog&&<ProjectActionDialogV2 key={actionDialog.action+':'+actionDialog.project.id} project={actionDialog.project} action={actionDialog.action} packs={ownerPacks} userId={user?.id} onClose={()=>setActionDialog(null)} onChanged={onProjectChanged}/>}
  {editorOpen&&isOwner&&<EditProfilePanelV2 key={String(user.id)} user={user} profile={visibleProfileUser||user} catalog={visibleProjects.catalog}
    onClose={()=>setEditorOpen(false)} onIdentityUpdated={onIdentityUpdated} onProfileUpdated={()=>setRefreshRevision(v=>v+1)}/>}
  </section>
}
