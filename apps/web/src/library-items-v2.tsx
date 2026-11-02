// 1CE v2 private library. Never requests v1 data.
import React,{useEffect,useState} from 'react';
import './library-items-v2.css';
const api=import.meta.env.VITE_API_URL;
type BeatItem = {id:string;title:string;cover_file_id:number|null;stems_file_id:number|null;pack_count:number;created_at:string};
type PackItem = {id:string;title:string;cover_file_id:number|null;track_count:number;created_at:string};
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
 return <div className="v2-item-cover">{url?<img src={url} alt={title+' cover'}/>:<span>{title.trim().charAt(0).toUpperCase()||'♪'}</span>}</div>;
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
    <div className="beat-pack-grid">
     {data.packs.map((p,index)=><article key={'pack-'+p.id} className="v2-library-card">
      <div className={'beat-pack-art beat-art-'+index%3} aria-label={'Pack '+p.title}><Cover id={p.cover_file_id} title={p.title}/></div>
      <div className="beat-pack-caption"><span className="v2-card-name">{p.title}</span></div>
      <p>{p.track_count} beats</p>
     </article>)}
     {data.beats.map((b,index)=><article key={'beat-'+b.id} className="v2-library-card beat-single-card">
      <div className={'beat-pack-art beat-art-'+(data.packs.length+index)%3} aria-label={'Beat '+b.title}><Cover id={b.cover_file_id} title={b.title}/></div>
      <div className="beat-pack-caption"><span className="v2-card-name">{b.title}</span></div>
      <p>{b.created_at?new Date(b.created_at).toLocaleDateString('en-US',{month:'short',day:'2-digit'}):'Beat'}</p>
     </article>)}
    </div>
   </div>}
 </div></div></section>;
}
