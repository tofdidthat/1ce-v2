import React,{useState} from 'react';
import {Bookmark,Users,Share2} from 'lucide-react';
import './public-profile-v2.css';

function CatalogLibraryIcon({size=17}:{size?:number}){
 // Same SVG paths and styling as the Library navigation HomeMark.
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4v16M9 4v16M14 4l4 16"/></svg>;
}
type ProfileTab='catalog'|'saves'|'following';
export default function PublicProfileV2({user,onSettings}:{user:any;onSettings:()=>void}){
 const [tab,setTab]=useState<ProfileTab>('catalog');
 const name=String(user?.displayName||user?.name||user?.username||'Your profile');
 const handle=String(user?.username||user?.handle||'');
 const picture=user?.customPicture||user?.picture||'';
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
   {tab==='catalog'?<div className="onece-profile-empty"><CatalogLibraryIcon size={27}/><h2>No public releases yet</h2><p>Beats and packs will appear here when published. Private Library files are never displayed automatically.</p></div>:
   tab==='saves'?<div className="onece-profile-empty"><Bookmark size={27}/><h2>No public saves yet</h2><p>Your saved public music will appear here once profile saves are connected.</p></div>:
   <div className="onece-profile-empty"><Users size={27}/><h2>Not following anyone yet</h2><p>Artists you follow will appear here once following is available.</p></div>}
  </div>
 </section>
}
