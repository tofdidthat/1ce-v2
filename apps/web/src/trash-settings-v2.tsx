import React,{useEffect,useState} from 'react';
import {ArrowLeft,Trash2,RotateCcw} from 'lucide-react';
import {notifyV2DataChanged} from './data-refresh-v2';
import './trash-settings-v2.css';

const api=import.meta.env.VITE_API_URL;
type TrashItem={id:string;kind:'beat'|'pack';title:string;deleted_at:string};
type TrashData={items:TrashItem[];pendingMedia:number;retentionDays:number};
const initial:TrashData={items:[],pendingMedia:0,retentionDays:30};
async function request(path:string,method:'GET'|'POST'='GET',body?:unknown){
 if(!api)throw Error('API is not configured.');
 const res=await fetch(api+path,{method,credentials:'include',cache:'no-store',
  ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 const data=await res.json().catch(()=>({}));
 if(!res.ok&&res.status!==202)throw Error(data.error||'Unable to update Trash.');
 return data;
}
export default function TrashSettingsV2({userId,onBack}:{userId:number;onBack:()=>void}){
 const [data,setData]=useState<TrashData>(initial);
 const [loading,setLoading]=useState(true);
 const [working,setWorking]=useState(false);
 const [confirm,setConfirm]=useState('');
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 async function reload(){const next=await request('/api/library/trash');setData(next);}
 useEffect(()=>{
  let active=true;
  request('/api/library/trash').then(next=>{if(active)setData(next);})
   .catch(err=>{if(active)setError(err.message);})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false};
 },[userId]);
 async function restore(item:TrashItem){
  if(working)return;
  setWorking(true);setError('');setNotice('');
  try{
   await request('/api/library/trash/'+item.kind+'/'+item.id+'/restore','POST');
   await reload();
   notifyV2DataChanged(['library','publications','saves','shares'],userId);
   setNotice('Project restored to Home. Sharing and publishing remain off.');
  }catch(err){setError(err instanceof Error?err.message:'Unable to restore.');}
  finally{setWorking(false);}
 }
 async function empty(){
  if(working||confirm!=='EMPTY TRASH')return;
  setWorking(true);setError('');setNotice('');
  try{
   const result=await request('/api/library/trash/empty','POST',{confirmation:confirm});
   setConfirm('');
   await reload();
   notifyV2DataChanged(['library','publications','saves','shares'],userId);
   setNotice(result.done
    ?'Trash permanently emptied. Unreferenced verified media was removed from R2.'
    :'Projects removed from Trash. Some R2 deletions are still pending; repeat Empty Trash to retry.');
  }catch(err){setError(err instanceof Error?err.message:'Unable to empty Trash.');}
  finally{setWorking(false);}
 }
 const count=data.items.length;
 return <section className="onece-account-card onece-trash-settings" aria-label="Trash">
  <header className="onece-trash-heading">
   <button type="button" onClick={onBack} className="onece-trash-back" aria-label="Back to Settings" disabled={working}><ArrowLeft size={17}/></button>
   <div><h2><Trash2 size={17}/> Trash</h2><p>Restore deleted projects for up to 30 days.</p></div>
  </header>
  {loading?<p className="onece-trash-info">Loading Trash…</p>:<>
   {count===0?<p className="onece-trash-info">Your Trash is empty.</p>:
    <ul className="onece-trash-items">
     {data.items.map(item=><li key={item.kind+item.id}>
      <div><strong>{item.title}</strong><span>{item.kind==='pack'?'Pack':'Beat'} · Deleted {new Date(item.deleted_at).toLocaleDateString('en-US')}</span></div>
      <button type="button" onClick={()=>void restore(item)} disabled={working||Date.now()-new Date(item.deleted_at).getTime()>30*86400000} title="Restore project"><RotateCcw size={15}/> Restore</button>
     </li>)}
    </ul>}
   {(count>0||data.pendingMedia>0)&&<div className="onece-trash-permanent">
    <h3>Empty Trash</h3>
    <p>This permanently removes deleted projects. Only unreferenced media is deleted from Cloudflare R2; files still used by another project are preserved. This action cannot be undone.</p>
    {data.pendingMedia>0&&<p className="onece-trash-pending">{data.pendingMedia} R2 deletion(s) pending. You can retry cleanup here.</p>}
    <label>Type <strong>EMPTY TRASH</strong> to confirm
     <input value={confirm} disabled={working} placeholder="EMPTY TRASH" onChange={e=>setConfirm(e.target.value)} autoCapitalize="characters" spellCheck={false}/></label>
    <button type="button" className="onece-trash-empty-button" disabled={working||confirm!=='EMPTY TRASH'} onClick={()=>void empty()}>{working?'Processing…':'Empty Trash permanently'}</button>
   </div>}
  </>}
  {error&&<p className="onece-trash-error" role="alert">{error}</p>}
  {notice&&<p className="onece-trash-notice" role="status">{notice}</p>}
 </section>;
}
