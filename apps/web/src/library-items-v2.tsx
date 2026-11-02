// 1CE v2 private library. Never requests v1 data.
import React,{useEffect,useState} from 'react';
import './library-items-v2.css';
const api=import.meta.env.VITE_API_URL;
type BeatItem = {id:string;title:string;cover_file_id:number|null;stems_file_id:number|null;pack_count:number};
type PackItem = {id:string;title:string;cover_file_id:number|null;track_count:number};
type LibraryData = {beats:BeatItem[];packs:PackItem[]};
function Cover({id,title}:{id:number|null;title:string}){
 const [url,setUrl]=useState('');
 useEffect(()=>{
  if(!id||!api)return;
  let active=true;let objectUrl='';
  fetch(api+'/api/library/files/cover/'+id,{credentials:'include'})
   .then(r=>{if(!r.ok)throw Error('Cover unavailable');return r.blob()})
   .then(blob=>{objectUrl=URL.createObjectURL(blob);if(active)setUrl(objectUrl);else URL.revokeObjectURL(objectUrl)})
   .catch(()=>{});
  return ()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)};
 },[id]);
 return <div className="v2-item-cover">{url?<img src={url} alt={title+' cover'}/>:<span>♫</span>}</div>;
}
export default function LibraryItemsV2({onUpload}:{onUpload:()=>void}){
 const [data,setData]=useState<LibraryData>({beats:[],packs:[]});
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  if(!api){setError('Library API is not configured');setLoading(false);return;}
  fetch(api+'/api/library/files/items',{credentials:'include',signal:controller.signal})
   .then(async r=>{const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||'Unable to load Library');return body})
   .then(body=>setData({beats:body.beats||[],packs:body.packs||[]}))
   .catch(e=>{if(e.name!=='AbortError')setError(e.message||'Unable to load Library')})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return ()=>controller.abort();
 },[]);
 const empty=!data.beats.length&&!data.packs.length;
 return <section className="beat-profile library-page onece-v2-library"><div className="beat-profile-content"><div className="library-items">
  {loading?<p className="v2-library-status">Loading your Library…</p>:
   error?<div className="v2-library-status" role="alert">{error}<button onClick={()=>window.location.reload()}>Retry</button></div>:
   empty?<div className="library-empty"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 4v16M9 4v16M14 4l4 16"/></svg><h2>Your Library is Empty</h2><button type="button" className="library-add-audio" onClick={onUpload}>Add Audio</button></div>:
   <div className="v2-library-contents">
    {data.packs.length>0&&<><h2>Packs <small>{data.packs.length}</small></h2><div className="v2-library-grid">{data.packs.map(p=><article key={p.id} className="v2-library-item"><Cover id={p.cover_file_id} title={p.title}/><strong>{p.title}</strong><span>{p.track_count} beats · Pack</span></article>)}</div></>}
    {data.beats.length>0&&<><h2>Beats <small>{data.beats.length}</small></h2><div className="v2-library-grid">{data.beats.map(b=><article key={b.id} className="v2-library-item"><Cover id={b.cover_file_id} title={b.title}/><strong>{b.title}</strong><span>{b.pack_count>0?'In '+b.pack_count+' pack(s) · ':''}Beat{b.stems_file_id?' · Stems':''}</span></article>)}</div></>}
   </div>}
 </div></div></section>;
}
