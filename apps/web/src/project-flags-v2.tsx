import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {notifyV2DataChanged,subscribeV2DataChanges,subscribeV2Resume} from './data-refresh-v2';
import {setProjectPublishedV2,setProjectSavedV2} from './project-requests-v2';
import {normalizeViewerProjectFlagsV2,savedProjectKeyV2,publishedProjectKeyV2,type ProjectKindV2} from './project-identity-v2';

const api=import.meta.env.VITE_API_URL;
const EMPTY_SAVED:ReadonlySet<string>=new Set<string>();
const EMPTY_PUBLISHED:ReadonlySet<string>=new Set<string>();
export type ProjectFlagsStatusV2='loading'|'ready'|'error';

type FlagsState={
 viewerId:number|null;saved:ReadonlySet<string>;published:ReadonlySet<string>;
 status:ProjectFlagsStatusV2;error:string|null;
};
type FlagsContextValue={
 saved:ReadonlySet<string>;published:ReadonlySet<string>;
 status:ProjectFlagsStatusV2;error:string|null;
 isSaved:(ownerId:number,kind:ProjectKindV2,id:string)=>boolean;
 isPublished:(kind:ProjectKindV2,id:string)=>boolean;
 toggleSaved:(ownerId:number,kind:ProjectKindV2,id:string)=>Promise<boolean>;
 togglePublished:(kind:ProjectKindV2,id:string)=>Promise<boolean>;
 refresh:()=>void;
};
const Context=createContext<FlagsContextValue|null>(null);
const EMPTY:FlagsState={viewerId:null,saved:EMPTY_SAVED,published:EMPTY_PUBLISHED,status:'loading',error:null};

// A single viewer-scoped copy of /api/public/mine for both Library and Profile.
// Unlike a false Save/Publish flag, "not loaded" is not permission to mutate.
// The backend is still authoritative for all project and media permissions.
export function ProjectFlagsProviderV2({viewerId,children}:{viewerId?:number|null;children:React.ReactNode}){
 const id=viewerId&&Number.isSafeInteger(viewerId)&&viewerId>0?viewerId:null;
 const [flags,setFlags]=useState<FlagsState>(EMPTY);
 const [revision,setRevision]=useState(0);
 const pending=useRef(new Set<string>());
 const activeViewer=useRef(id);
 activeViewer.current=id;
 const refresh=useCallback(()=>setRevision(value=>value+1),[]);
 const matchesViewer=flags.viewerId===id;
 const status:ProjectFlagsStatusV2=!id?'error':matchesViewer?flags.status:'loading';
 const error=!id?'Sign in to manage projects':matchesViewer?flags.error:null;
 // Never show stale flags as negative answers during a fresh fetch or after error.
 // Consumers disable Save/Publish while status is not "ready".
 const saved=status==='ready'?flags.saved:EMPTY_SAVED;
 const published=status==='ready'?flags.published:EMPTY_PUBLISHED;

 useEffect(()=>subscribeV2DataChanges(['saves','publications','shares','library'],refresh,id),[id,refresh]);
 useEffect(()=>subscribeV2Resume(refresh),[refresh]);
 useEffect(()=>{
  if(!id){setFlags(EMPTY);return;}
  if(!api){
   setFlags({viewerId:id,saved:EMPTY_SAVED,published:EMPTY_PUBLISHED,status:'error',error:'Project API is not configured'});
   return;
  }
  const controller=new AbortController();
  setFlags(previous=>({
   viewerId:id,
   saved:previous.viewerId===id?previous.saved:EMPTY_SAVED,
   published:previous.viewerId===id?previous.published:EMPTY_PUBLISHED,
   status:'loading',error:null
  }));
  void (async()=>{
   try{
    const response=await fetch(api+'/api/public/mine',{credentials:'include',cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error('Unable to load project Saves and publications');
    const payload:unknown=await response.json();
    if(controller.signal.aborted||activeViewer.current!==id)return;
    setFlags({...normalizeViewerProjectFlagsV2(id,payload),status:'ready',error:null});
   }catch(err){
    if(controller.signal.aborted||activeViewer.current!==id)return;
    setFlags({viewerId:id,saved:EMPTY_SAVED,published:EMPTY_PUBLISHED,status:'error',
     error:err instanceof Error?err.message:'Unable to load project Saves and publications'});
   }
  })();
  return()=>controller.abort();
 },[id,revision]);

 const isSaved=useCallback((ownerId:number,kind:ProjectKindV2,projectId:string)=>
  saved.has(savedProjectKeyV2(ownerId,kind,projectId)),[saved]);
 const isPublished=useCallback((kind:ProjectKindV2,projectId:string)=>
  published.has(publishedProjectKeyV2(kind,projectId)),[published]);

 const requireReady=()=>{
  if(!id)throw Error('Sign in to manage projects');
  if(status!=='ready')throw Error(error||'Project status is still loading. Try again.');
  return id;
 };
 const toggleSaved=useCallback(async(ownerId:number,kind:ProjectKindV2,projectId:string)=>{
  const viewer=requireReady();
  const key=savedProjectKeyV2(ownerId,kind,projectId),inflight=viewer+':save:'+key;
  if(pending.current.has(inflight))throw Error('Save change is already in progress');
  pending.current.add(inflight);
  const wasSaved=saved.has(key);
  try{
   await setProjectSavedV2(ownerId,kind,projectId,wasSaved);
   if(activeViewer.current!==viewer){notifyV2DataChanged(['saves'],viewer);return !wasSaved;}
   setFlags(previous=>{
    const updated=new Set(previous.viewerId===viewer?previous.saved:EMPTY_SAVED);
    if(wasSaved)updated.delete(key);else updated.add(key);
    return {...previous,viewerId:viewer,saved:updated};
   });
   notifyV2DataChanged(['saves'],viewer);
   return !wasSaved;
  }finally{pending.current.delete(inflight);}
 },[id,saved,status,error]);

 const togglePublished=useCallback(async(kind:ProjectKindV2,projectId:string)=>{
  const viewer=requireReady();
  const key=publishedProjectKeyV2(kind,projectId),inflight=viewer+':publish:'+key;
  if(pending.current.has(inflight))throw Error('Publication change is already in progress');
  pending.current.add(inflight);
  const wasPublished=published.has(key);
  try{
   await setProjectPublishedV2(kind,projectId,wasPublished);
   if(activeViewer.current!==viewer){notifyV2DataChanged(['publications'],viewer);return !wasPublished;}
   setFlags(previous=>{
    const updated=new Set(previous.viewerId===viewer?previous.published:EMPTY_PUBLISHED);
    if(wasPublished)updated.delete(key);else updated.add(key);
    return {...previous,viewerId:viewer,published:updated};
   });
   notifyV2DataChanged(['publications'],viewer);
   return !wasPublished;
  }finally{pending.current.delete(inflight);}
 },[id,published,status,error]);

 const value=useMemo<FlagsContextValue>(()=>({saved,published,status,error,isSaved,isPublished,toggleSaved,togglePublished,refresh}),
  [saved,published,status,error,isSaved,isPublished,toggleSaved,togglePublished,refresh]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}

export default function useProjectFlagsV2(){
 const value=useContext(Context);
 if(!value)throw Error('ProjectFlagsProviderV2 is required above Library and Profile');
 return value;
}
