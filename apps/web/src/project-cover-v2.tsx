import React,{useEffect,useState} from 'react';

const api=import.meta.env.VITE_API_URL;

// The same private, project-aware cover endpoint is used in Library, Catalog and Saves.
// An absent/unauthorized cover is represented by the same title fallback everywhere.
export default function ProjectCoverV2({ownerId,fileId,title,className,alt}:{ownerId?:number|null;fileId?:number|null;title:string;className:string;alt?:string}){
 const [src,setSrc]=useState('');
 useEffect(()=>{
  setSrc('');
  if(!api||!ownerId||!fileId)return;
  const controller=new AbortController();
  let alive=true,objectUrl='';
  void (async()=>{
   try{
    const response=await fetch(api+'/api/public/cover/'+ownerId+'/'+fileId,{credentials:'include',signal:controller.signal});
    if(!response.ok)throw Error('Cover unavailable');
    const blob=await response.blob();
    if(!blob.type.startsWith('image/'))return;
    objectUrl=URL.createObjectURL(blob);
    if(alive)setSrc(objectUrl);
    else URL.revokeObjectURL(objectUrl);
   }catch{ /* missing/private image: show the same fallback in every view */ }
  })();
  return()=>{alive=false;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)};
 },[ownerId,fileId]);
 return <div className={className}>{src?<img src={src} alt={alt??(title+' cover')}/>:<span>{title.trim().charAt(0).toUpperCase()||'♪'}</span>}</div>;
}
