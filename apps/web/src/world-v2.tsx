import React,{useEffect,useState} from 'react';
import {Compass,Users,ChevronRight} from 'lucide-react';
import {getProfileFollowsV2,type FollowedAccountV2} from './profile-follows-v2';
import {profilePictureV2} from './profile-picture-v2';
import {subscribeV2DataChanges,subscribeV2Resume} from './data-refresh-v2';
import './world-v2.css';

type WorldTab='for-you'|'following';
type FollowingState={viewerId:number|null;status:'idle'|'loading'|'ready'|'error';users:FollowedAccountV2[];error:string};
const EMPTY:FollowingState={viewerId:null,status:'idle',users:[],error:''};

// The World feed UI is intentionally independent from the Catalog/Following
// tabs on another user's public profile. No invented recommendations or grants.
export default function WorldV2({userId,onOpenProfile}:{userId?:number;onOpenProfile:(identifier:string)=>void}){
 const [tab,setTab]=useState<WorldTab>('for-you');
 const [refresh,setRefresh]=useState(0);
 const [following,setFollowing]=useState<FollowingState>(EMPTY);
 const viewerId=Number.isSafeInteger(userId)&&Number(userId)>0?Number(userId):null;
 const visibleFollowing=following.viewerId===viewerId?following:EMPTY;
 const tabButtons=React.useRef<Array<HTMLButtonElement|null>>([]);

 useEffect(()=>subscribeV2DataChanges(['follows'],()=>setRefresh(value=>value+1),viewerId),[viewerId]);
 useEffect(()=>subscribeV2Resume(()=>setRefresh(value=>value+1)),[viewerId]);
 useEffect(()=>{
  if(tab!=='following'||!viewerId)return;
  const controller=new AbortController();
  // Returning to the Following tab or resuming the window revalidates in the
  // background while the last verified list for this viewer stays visible.
  setFollowing(previous=>previous.viewerId===viewerId&&previous.status==='ready'
   ?{...previous,error:''}
   :{viewerId,status:'loading',users:[],error:''});
  getProfileFollowsV2(viewerId,controller.signal)
   .then(result=>{
    if(!controller.signal.aborted)setFollowing({
     viewerId,status:'ready',users:Array.isArray(result.followingUsers)?result.followingUsers:[],error:''
    });
   })
   .catch(error=>{
    if(!controller.signal.aborted)setFollowing({
     viewerId,status:'error',users:[],error:error instanceof Error?error.message:'Unable to load following'
    });
   });
  return()=>controller.abort();
 },[tab,viewerId,refresh]);

 const tabs:{id:WorldTab;label:string}[]=[{id:'for-you',label:'For you'},{id:'following',label:'Following'}];
 return <section className="onece-world" aria-label="World">
  <div className="onece-world-heading"><h1>World</h1></div>
  <nav className="onece-world-tabs" role="tablist" aria-label="World sections">
   {tabs.map((item,index)=><button
    key={item.id} ref={element=>{tabButtons.current[index]=element;}}
    type="button" role="tab" id={'onece-world-tab-'+item.id}
    aria-controls="onece-world-panel" aria-selected={tab===item.id}
    tabIndex={tab===item.id?0:-1} className={tab===item.id?'is-active':''}
    onClick={()=>setTab(item.id)}
    onKeyDown={event=>{
     const next=event.key==='ArrowRight'?(index+1)%tabs.length:
      event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:
      event.key==='Home'?0:event.key==='End'?tabs.length-1:-1;
     if(next>=0){event.preventDefault();setTab(tabs[next].id);tabButtons.current[next]?.focus();}
    }}>{item.label}</button>)}
  </nav>
  <div className="onece-world-panel" id="onece-world-panel" role="tabpanel" aria-labelledby={'onece-world-tab-'+tab}>
   {tab==='for-you'?
    <section className="onece-world-content" aria-label="Suggested">
     <h2>Suggested</h2>
     <div className="onece-world-empty"><Compass size={28} strokeWidth={1.45}/>
      <h3>Discover new sounds</h3>
      <p>Recommendations will appear here when the World feed is available.</p>
     </div>
    </section>:
    <section className="onece-world-content" aria-label="Following">
     <h2>Following</h2>
     {!viewerId?<div className="onece-world-empty"><Users size={27} strokeWidth={1.45}/><h3>Sign in to see who you follow</h3></div>:
      visibleFollowing.status==='loading'||visibleFollowing.status==='idle'?
       <p className="onece-world-status" role="status">Loading following…</p>:
      visibleFollowing.status==='error'?
       <div className="onece-world-status" role="alert">{visibleFollowing.error}
        <button type="button" onClick={()=>setRefresh(value=>value+1)}>Retry</button>
       </div>:
      visibleFollowing.users.length?
       <div className="onece-world-people">{visibleFollowing.users.map(person=>{
        const name=person.username||person.name||'Artist';
        const picture=profilePictureV2(person);
        return <button key={person.id} type="button" className="onece-world-person"
         onClick={()=>onOpenProfile(person.username||String(person.id))}
         aria-label={'Open '+name+' profile'}>
         <span className="onece-world-avatar">{picture?<img src={picture} alt="" referrerPolicy="no-referrer"/>:name.charAt(0).toUpperCase()}</span>
         <span className="onece-world-person-name"><strong>{name}</strong><small>Artist</small></span>
         <ChevronRight size={18} aria-hidden="true"/>
        </button>;
       })}</div>:
       <div className="onece-world-empty"><Users size={27} strokeWidth={1.45}/>
        <h3>No artists followed yet</h3>
        <p>When you follow someone, their profile will show up here.</p>
       </div>}
    </section>}
  </div>
 </section>;
}
