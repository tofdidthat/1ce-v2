import React,{createContext,useContext,useEffect,useMemo,useState} from 'react';
import {ProjectCoverCacheV2} from './project-cover-cache-v2';

const api=import.meta.env.VITE_API_URL;
const CoverContext=createContext<ProjectCoverCacheV2|null>(null);

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
 useEffect(()=>()=>cache.clear(),[cache]);
 return <CoverContext.Provider value={cache}>{children}</CoverContext.Provider>;
}

export function useProjectCoverUrlV2(ownerId?:number|null,fileId?:number|null):string{
 const cache=useContext(CoverContext);
 if(!cache)throw Error('ProjectCoverCacheProviderV2 is required above cover consumers');
 const valid=Number.isSafeInteger(ownerId)&&Number(ownerId)>0&&Number.isSafeInteger(fileId)&&Number(fileId)>0;
 const key=valid?ownerId+':'+fileId:'';
 const [loaded,setLoaded]=useState<{cache:ProjectCoverCacheV2;key:string;url:string|null}|null>(null);
 // Never render the previous viewer's or previous file's Blob URL, even for a
 // single render before the effect for the new identity runs.
 const url=loaded?.cache===cache&&loaded.key===key?loaded.url:
  valid?cache.peek(Number(ownerId),Number(fileId)):null;
 useEffect(()=>{
  if(!valid){setLoaded(null);return;}
  const lease=cache.acquire(Number(ownerId),Number(fileId));
  let alive=true;
  setLoaded({cache,key,url:lease.url});
  void lease.ready.then(next=>{if(alive)setLoaded({cache,key,url:next});});
  return()=>{alive=false;lease.release();};
 },[cache,key]);
 return url||'';
}

// One cover component across Library, Catalog, Saves and pack/beat details.
// A missing or unauthorized image has the same fallback in every view.
export default function ProjectCoverV2({ownerId,fileId,title,className,alt}:{ownerId?:number|null;fileId?:number|null;title:string;className:string;alt?:string}){
 const src=useProjectCoverUrlV2(ownerId,fileId);
 return <div className={className}>{src?<img src={src} alt={alt??(title+' cover')}/>:<span>{title.trim().charAt(0).toUpperCase()||'♪'}</span>}</div>;
}
