import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {notifyV2DataChanged,subscribeV2DataChanges,subscribeV2Resume} from './data-refresh-v2';
import {setProjectPublishedV2,setProjectSavedV2} from './project-requests-v2';
import {normalizeViewerProjectFlagsV2,savedProjectKeyV2,publishedProjectKeyV2,type ProjectKindV2} from './project-identity-v2';

const api=import.meta.env.VITE_API_URL;
const EMPTY_SAVED:ReadonlySet<string>=new Set<string>();
const EMPTY_PUBLISHED:ReadonlySet<string>=new Set<string>();

type FlagsState={viewerId:number|null;saved:ReadonlySet<string>;published:ReadonlySet<string>};
type FlagsContextValue={
 saved:ReadonlySet<string>;published:ReadonlySet<string>;
 isSaved:(ownerId:number,kind:ProjectKindV2,id:string)=>boolean;
 isPublished:(kind:ProjectKindV2,id:string)=>boolean;
 toggleSaved:(ownerId:number,kind:ProjectKindV2,id:string)=>Promise<boolean>;
 togglePublished:(kind:ProjectKindV2,id:string)=>Promise<boolean>;
 refresh:()=>void;
};
const Context=createContext<FlagsContextValue|null>(null);
const EMPTY:FlagsState={viewerId:null,saved:EMPTY_SAVED,published:EMPTY_PUBLISHED};

// A single viewer-scoped copy of /api/public/mine for both Library and Profile.
// It cannot grant authorization: all mutations and media reads are server checked.
export function ProjectFlagsProviderV2({viewerId,children}:{viewerId?:number|null;children:React.ReactNode}){
 const id=viewerId&&Number.isSafeInteger(viewerId)&&viewerId>0?viewerId:null;
 const [flags,setFlags]=useState<FlagsState>(EMPTY);
 const [revision,setRevision]=useState(0);
 const pending=useRef(new Set<string>());
 const activeViewer=useRef(id);
 activeViewer.current=id;
 const refresh=useCallback(()=>setRevision(value=>value+1),[]);
 // Changing accounts must never expose the prior account's saved/published flags.
 const saved=flags.viewerId===id?flags.saved:EMPTY_SAVED;
 const published=flags.viewerId===id?flags.published:EMPTY_PUBLISHED;

 useEffect(()=>subscribeV2DataChanges(['saves','publications','shares','library'],refresh,id),[id,refresh]);
 useEffect(()=>subscribeV2Resume(refresh),[refresh]);
 useEffect(()=>{
  if(!id||!api){setFlags(EMPTY);return;}
  const controller=new AbortController();
  void (async()=>{
   try{
    const response=await fetch(api+'/api/public/mine',{credentials:'include',cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error('Project flags unavailable');
    const payload:unknown=await response.json();
    if(controller.signal.aborted||activeViewer.current!==id)return;
    setFlags(normalizeViewerProjectFlagsV2(id,payload));
   }catch{
    // Preserve the last confirmed state after a transient network error.
    // Server remains authoritative and will revalidate on focus/notifications.
   }
  })();
  return()=>controller.abort();
 },[id,revision]);

 const isSaved=useCallback((ownerId:number,kind:ProjectKindV2,projectId:string)=>
  saved.has(savedProjectKeyV2(ownerId,kind,projectId)),[saved]);
 const isPublished=useCallback((kind:ProjectKindV2,projectId:string)=>
  published.has(publishedProjectKeyV2(kind,projectId)),[published]);

 const toggleSaved=useCallback(async(ownerId:number,kind:ProjectKindV2,projectId:string)=>{
  if(!id)throw Error('Sign in to save projects');
  const key=savedProjectKeyV2(ownerId,kind,projectId),inflight='save:'+key;
  if(pending.current.has(inflight))throw Error('Save change is already in progress');
  pending.current.add(inflight);
  const wasSaved=saved.has(key);
  try{
   await setProjectSavedV2(ownerId,kind,projectId,wasSaved);
   if(activeViewer.current!==id){notifyV2DataChanged(['saves'],id);return !wasSaved;}
   setFlags(previous=>{
    const updated=new Set(previous.viewerId===id?previous.saved:EMPTY_SAVED);
    if(wasSaved)updated.delete(key);else updated.add(key);
    return {viewerId:id,saved:updated,published:previous.viewerId===id?previous.published:EMPTY_PUBLISHED};
   });
   notifyV2DataChanged(['saves'],id);
   return !wasSaved;
  }finally{pending.current.delete(inflight);}
 },[id,saved]);

 const togglePublished=useCallback(async(kind:ProjectKindV2,projectId:string)=>{
  if(!id)throw Error('Sign in to publish projects');
  const key=publishedProjectKeyV2(kind,projectId),inflight='publish:'+key;
  if(pending.current.has(inflight))throw Error('Publication change is already in progress');
  pending.current.add(inflight);
  const wasPublished=published.has(key);
  try{
   await setProjectPublishedV2(kind,projectId,wasPublished);
   if(activeViewer.current!==id){notifyV2DataChanged(['publications'],id);return !wasPublished;}
   setFlags(previous=>{
    const updated=new Set(previous.viewerId===id?previous.published:EMPTY_PUBLISHED);
    if(wasPublished)updated.delete(key);else updated.add(key);
    return {viewerId:id,saved:previous.viewerId===id?previous.saved:EMPTY_SAVED,published:updated};
   });
   notifyV2DataChanged(['publications'],id);
   return !wasPublished;
  }finally{pending.current.delete(inflight);}
 },[id,published]);

 const value=useMemo<FlagsContextValue>(()=>({saved,published,isSaved,isPublished,toggleSaved,togglePublished,refresh}),
  [saved,published,isSaved,isPublished,toggleSaved,togglePublished,refresh]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}

export default function useProjectFlagsV2(){
 const value=useContext(Context);
 if(!value)throw Error('ProjectFlagsProviderV2 is required above Library and Profile');
 return value;
}
