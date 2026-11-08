import React,{createContext,useContext,useEffect,useMemo,useState} from 'react';
import {ProjectCoverCacheV2} from './project-cover-cache-v2';
import {subscribeV2DataChanges} from './data-refresh-v2';

const api=import.meta.env.VITE_API_URL;
type CoverContextValueV2={cache:ProjectCoverCacheV2;revision:number};
const CoverContext=createContext<CoverContextValueV2|null>(null);

// Always request authorization from the API; the browser keeps only a bounded
// in-memory copy of the response for this viewer's current Workspace lifetime.
async function loadAuthorizedCover(ownerId:number,fileId:number,signal:AbortSignal):Promise<Blob>{
 if(!api)throw Error('Cover API is not configured');
 const response=await fetch(api+'/api/public/cover/'+ownerId+'/'+fileId,{
  credentials:'include',cache:'no-store',signal
 });
 if(!response.ok)throw Error('Cover unavailable');
 return response.blob();
}

export function ProjectCoverCacheProviderV2({viewerId,children}:{viewerId?:number|null;children:React.ReactNode}){
 // A new viewer gets a completely separate cache, including when switching
 // between anonymous and authenticated profiles within one SPA session.
 const cache=useMemo(()=>new ProjectCoverCacheV2(loadAuthorizedCover),[viewerId]);
 const [revision,setRevision]=useState(0);
 useEffect(()=>()=>cache.clear(),[cache]);
 // Relevant owner mutations invalidate that owner's covers immediately. Bumping
 // the revision re-runs every mounted cover lease, so a changed, deleted or
 // first-published cover is fetched again without waiting for the 30 minute TTL
 // and without touching other accounts' cached covers.
 useEffect(()=>subscribeV2DataChanges(['library','publications'],change=>{
  if(change.actorId===null)return;
  cache.invalidateOwner(change.actorId);
  setRevision(value=>value+1);
 }),[cache]);
 return <CoverContext.Provider value={{cache,revision}}>{children}</CoverContext.Provider>;
}

export function useProjectCoverUrlV2(ownerId?:number|null,fileId?:number|null):string{
 const context=useContext(CoverContext);
 if(!context)throw Error('ProjectCoverCacheProviderV2 is required above cover consumers');
 const {cache,revision}=context;
 const valid=Number.isSafeInteger(ownerId)&&Number(ownerId)>0&&Number.isSafeInteger(fileId)&&Number(fileId)>0;
 const key=valid?ownerId+':'+fileId:'';
 const [loaded,setLoaded]=useState<{cache:ProjectCoverCacheV2;key:string;url:string|null}|null>(null);
 // Never render the previous viewer's, previous file's or invalidated Blob URL,
 // even for a single render before the effect for the new identity runs.
 const cached=valid?cache.peek(Number(ownerId),Number(fileId)):null;
 const url=loaded?.cache===cache&&loaded.key===key&&cached?loaded.url:cached;
 useEffect(()=>{
  if(!valid){setLoaded(null);return;}
  const lease=cache.acquire(Number(ownerId),Number(fileId));
  let alive=true;
  setLoaded({cache,key,url:lease.url});
  void lease.ready.then(next=>{if(alive)setLoaded({cache,key,url:next});});
  return()=>{alive=false;lease.release();};
 },[cache,key,revision]);
 return url||'';
}

// One cover component across Library, Catalog, Saves and pack/beat details.
// A missing or unauthorized image has the same fallback in every view.
export default function ProjectCoverV2({ownerId,fileId,title,className,alt}:{ownerId?:number|null;fileId?:number|null;title:string;className:string;alt?:string}){
 const src=useProjectCoverUrlV2(ownerId,fileId);
 return <div className={className}>{src?<img src={src} alt={alt??(title+' cover')}/>:<span>{title.trim().charAt(0).toUpperCase()||'♪'}</span>}</div>;
}
