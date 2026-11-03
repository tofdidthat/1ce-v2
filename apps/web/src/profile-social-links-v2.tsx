import React from 'react';
import {Instagram,Youtube,Plus} from 'lucide-react';
import CopyLinkIconV2 from './copy-link-icon-v2';

export type SocialPlatformV2='spotify'|'youtube'|'instagram'|'link';
export function platformForProfileLinkV2(url:string):SocialPlatformV2{
 try{
  const parsed=new URL(url);
  if(parsed.protocol!=='https:')return 'link';
  const host=parsed.hostname.replace(/^www\./,'').toLowerCase();
  if(host==='spotify.com'||host.endsWith('.spotify.com'))return 'spotify';
  if(host==='youtube.com'||host.endsWith('.youtube.com')||host==='youtu.be')return 'youtube';
  if(host==='instagram.com'||host.endsWith('.instagram.com'))return 'instagram';
 }catch{}
 return 'link';
}
export function ProfileLinkIconV2({url,size=18}:{url:string;size?:number}){
 const type=platformForProfileLinkV2(url);
 if(type==='youtube')return <Youtube size={size}/>;
 if(type==='instagram')return <Instagram size={size}/>;
 if(type==='spotify')return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
  <circle cx="12" cy="12" r="9"/><path d="M6.7 9.1c3.6-1 7.2-.5 10.7 1.2M7.6 12.5c3.1-.8 6.3-.4 9.2 1.2M8.3 15.5c2.5-.6 5-.3 7.3.9"/>
 </svg>;
 return <CopyLinkIconV2 size={size}/>;
}
export function ProfileSocialLinksV2({links,onAdd,onEdit,compact=false}:{links:readonly string[];onAdd?:()=>void;onEdit?:(index:number)=>void;compact?:boolean}){
 const items=links.filter(url=>typeof url==='string'&&url.startsWith('https://'));
 if(!items.length&&!onAdd)return null;
 return <div className={'onece-social-links'+(compact?' is-compact':'')} aria-label="Profile links">
  {items.map((url,index)=>onEdit?
   <button key={url+':'+index} type="button" className={'onece-social-link'+(platformForProfileLinkV2(url)==='link'?' is-generic':'')} aria-label={'Edit '+platformForProfileLinkV2(url)+' link'} title={url} onClick={()=>onEdit(index)}><ProfileLinkIconV2 url={url}/></button>:
   <a key={url+':'+index} className={'onece-social-link'+(platformForProfileLinkV2(url)==='link'?' is-generic':'')} href={url} target="_blank" rel="noopener noreferrer" title={url} aria-label={'Open '+platformForProfileLinkV2(url)+' link'}><ProfileLinkIconV2 url={url}/></a>)}
  {onAdd&&<button type="button" className="onece-social-add" aria-label="Add profile link" title="Add link" onClick={onAdd}><Plus size={18}/></button>}
 </div>;
}
