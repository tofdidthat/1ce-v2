import {createHash,randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {QueryableV2} from '../../../packages/shared/contracts.js';
import {resolveAuthorizedMediaFile} from './project-media.js';
import {validWaveform} from './waveform-peaks.js';

export const waveformSchema=`CREATE TABLE IF NOT EXISTS v2_audio_waveforms (
 file_id BIGINT PRIMARY KEY REFERENCES library_files(id) ON DELETE CASCADE,
 version TEXT NOT NULL,
 bars JSONB,
 lease_token UUID,
 retry_after TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (bars IS NULL OR (jsonb_typeof(bars)='array' AND jsonb_array_length(bars)=84))
)`;
const initialized=new WeakMap<QueryableV2,Promise<unknown>>();
function ready(db:QueryableV2){
 let promise=initialized.get(db);
 if(!promise){promise=db.query(waveformSchema).catch(error=>{initialized.delete(db);throw error});initialized.set(db,promise);}
 return promise;
}
type AudioJob={key:string;bytes:number;sha256:string|null;format:'mp3'|'wav'};
let running=0;
function generate(job:AudioJob):Promise<number[]>{
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./waveform-worker.js',import.meta.url),{
   workerData:job,resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:32}
  });
  let settled=false;
  const finish=(bars?:unknown)=>{
   if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();
   if(validWaveform(bars))resolve(bars);else reject(Error('Waveform generation unavailable'));
  };
  const timer=setTimeout(()=>finish(),90000);
  worker.once('message',(message:unknown)=>finish(message&&typeof message==='object'?(message as Record<string,unknown>).bars:null));
  worker.once('error',()=>finish());worker.once('exit',()=>finish());
 });
}
const send=(res:ServerResponse,status:number,data:unknown)=>{
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
  ...(status===202||status===503?{'Retry-After':'3'}:{})});res.end(JSON.stringify(data));
};
// Always authorize persisted metadata with exactly the existing audio policy.
export async function handleAudioWaveform(req:IncomingMessage,res:ServerResponse,pathname:string,db:QueryableV2,
 currentUser:(req:IncomingMessage)=>Promise<{id:number}|null>,
 {decode=generate}:{decode?:(job:AudioJob)=>Promise<number[]>}={}
):Promise<boolean>{
 const match=/^\/api\/public\/waveform\/([1-9]\d*)\/([1-9]\d*)$/.exec(pathname);
 if(!match)return false;
 if(req.method!=='GET'){send(res,405,{error:'Method not allowed'});return true;}
 const [,ownerId,fileId]=match;
 const viewer=await currentUser(req);
 const file=await resolveAuthorizedMediaFile(db,{ownerId,fileId,viewerId:viewer?.id,kind:'audio'});
 if(!file){send(res,404,{error:'Audio not found'});return true;}
 const source=await db.query("SELECT sha256 FROM library_files WHERE id=$1 AND user_id=$2 AND kind='audio' AND status='ready' AND object_key=$3",[fileId,ownerId,file.object_key]);
 const sha256=source.rows[0]?.sha256;
 if(sha256!==null&&(typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))){send(res,503,{error:'Audio version unavailable'});return true;}
 const bytes=Number(file.byte_size);
 if(!Number.isSafeInteger(bytes)||bytes<1||bytes>150*1024*1024){send(res,422,{error:'Unsupported audio size'});return true;}
 const format=/\.wav$/i.test(file.object_key)?'wav':/\.mp3$/i.test(file.object_key)?'mp3':null;
 if(!format){send(res,422,{error:'Unsupported audio format'});return true;}
 // Legacy READY uploads can predate stored SHA metadata. Their immutable key
 // and byte count still version the envelope without rewriting original media.
 const version=createHash('sha256').update('envelope-1:'+sha256+':'+file.object_key+':'+bytes).digest('hex');
 await ready(db);
 const cached=await db.query('SELECT bars FROM v2_audio_waveforms WHERE file_id=$1 AND version=$2',[fileId,version]);
 if(validWaveform(cached.rows[0]?.bars)){send(res,200,{bars:cached.rows[0].bars});return true;}
 if(running>=1){send(res,202,{status:'pending'});return true;}
 const token=randomUUID();
 running++;
 try{
 const claimed=await db.query(`INSERT INTO v2_audio_waveforms(file_id,version,lease_token,retry_after)
  VALUES($1,$2,$3::uuid,clock_timestamp()+interval '2 minutes')
  ON CONFLICT(file_id) DO UPDATE SET version=EXCLUDED.version,bars=NULL,
   lease_token=EXCLUDED.lease_token,retry_after=EXCLUDED.retry_after
  WHERE v2_audio_waveforms.version<>EXCLUDED.version OR
   (v2_audio_waveforms.bars IS NULL AND v2_audio_waveforms.retry_after<clock_timestamp())
  RETURNING file_id`,[fileId,version,token]);
 if(claimed.rowCount!==1){send(res,202,{status:'pending'});return true;}
  const bars=await decode({key:file.object_key,bytes,sha256,format});
  if(!validWaveform(bars))throw Error('Invalid generated waveform');
  const saved=await db.query(`UPDATE v2_audio_waveforms w SET bars=$4::jsonb,lease_token=NULL
   WHERE w.file_id=$1 AND w.version=$2 AND w.lease_token=$3::uuid AND w.retry_after>clock_timestamp()
   AND EXISTS (SELECT 1 FROM library_files f WHERE f.id=w.file_id AND f.user_id=$5
    AND f.kind='audio' AND f.status='ready' AND f.sha256 IS NOT DISTINCT FROM $6::text AND f.object_key=$7)
   RETURNING w.file_id`,[fileId,version,token,JSON.stringify(bars),ownerId,sha256,file.object_key]);
  if(saved.rowCount!==1){send(res,202,{status:'pending'});return true;}
  if(!await resolveAuthorizedMediaFile(db,{ownerId,fileId,viewerId:viewer?.id,kind:'audio'})){
   send(res,404,{error:'Audio not found'});return true;
  }
  send(res,200,{bars});
 }catch{
  await db.query(`UPDATE v2_audio_waveforms SET lease_token=NULL,retry_after=clock_timestamp()+interval '1 minute'
   WHERE file_id=$1 AND version=$2 AND lease_token=$3::uuid`,[fileId,version,token]);
  send(res,503,{error:'Waveform temporarily unavailable'});
 }finally{running--;}
 return true;
}
