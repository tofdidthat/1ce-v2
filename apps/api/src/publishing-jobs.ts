import {createHash} from 'node:crypto';
import type {QueryableV2} from '../../../packages/shared/contracts.js';
import {parsePublicationDraft,publicationRequestHash} from './publication-queue.js';
import {PublishingError} from './youtube-connection.js';
export type PublishingPool=QueryableV2&{connect():Promise<QueryableV2&{release():void}>};
export function parsePublicationInput(input:unknown){
 const draft=parsePublicationDraft(input);
 const raw=input as Record<string,unknown>;
 if(draft.targets.some(t=>t.platform!=='youtube')||draft.targets.length>2)throw new PublishingError('destination_not_available');
 if(/[<>]/.test(draft.title))throw new PublishingError('invalid_youtube_title');
 for(const field of ['audioFileId','coverFileId'])if(!Number.isSafeInteger(raw[field])||Number(raw[field])<1)throw new PublishingError('audio_and_cover_required');
 if(!['private','unlisted','public'].includes(String(raw.privacy)))throw new PublishingError('invalid_privacy');
 const media={audioFileId:Number(raw.audioFileId),coverFileId:Number(raw.coverFileId),privacy:String(raw.privacy)};
 const fingerprint=createHash('sha256').update(publicationRequestHash(draft)+JSON.stringify(media)).digest('hex');
 return {draft,...media,fingerprint};
}
export async function enqueuePublication(pool:PublishingPool,owner:number,input:unknown):Promise<{id:string;state:string}>{
 const data=parsePublicationInput(input),db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock($1::bigint)',[owner]);
  const existing=(await db.query('SELECT id,state,request_hash FROM v2_publication_jobs WHERE user_id=$1 AND request_id=$2::uuid',[owner,data.draft.requestId])).rows[0];
  if(existing){
   if(existing.request_hash!==data.fingerprint)throw new PublishingError('request_id_conflict',409);
   await db.query('COMMIT');return {id:String(existing.id),state:String(existing.state)};
  }
  const connected=await db.query('SELECT user_id FROM v2_youtube_connections WHERE user_id=$1 FOR SHARE',[owner]);
  if(connected.rowCount!==1)throw new PublishingError('youtube_reconnect_required',409);
  const pending=await db.query("SELECT count(*)::int AS total FROM v2_publication_jobs WHERE user_id=$1 AND state IN ('ready','running')",[owner]);
  if(Number(pending.rows[0]?.total)>=10)throw new PublishingError('publication_queue_full',429);
  const assets=await db.query(`SELECT id,kind,byte_size FROM library_files WHERE user_id=$1 AND status='ready'
   AND ((id=$2 AND kind='audio') OR (id=$3 AND kind='cover')) FOR KEY SHARE`,[owner,data.audioFileId,data.coverFileId]);
  const audio=assets.rows.find(r=>String(r.id)===String(data.audioFileId)&&r.kind==='audio');
  const cover=assets.rows.find(r=>String(r.id)===String(data.coverFileId)&&r.kind==='cover');
  if(!audio||!cover||Number(audio.byte_size)>150*1024*1024||Number(cover.byte_size)>15*1024*1024)throw new PublishingError('owned_ready_media_required',404);
  const job=(await db.query(`INSERT INTO v2_publication_jobs(user_id,request_id,request_hash,title,description,hashtags,state,audio_file_id,cover_file_id,privacy)
   VALUES($1,$2::uuid,$3,$4,$5,$6,'ready',$7,$8,$9) RETURNING id`,
  [owner,data.draft.requestId,data.fingerprint,data.draft.title,data.draft.description,data.draft.hashtags,data.audioFileId,data.coverFileId,data.privacy])).rows[0];
  for(const target of data.draft.targets)await db.query(`INSERT INTO v2_publication_targets(job_id,platform,variant,state)
   VALUES($1::uuid,'youtube',$2,'queued')`,[job.id,target.variant]);
  await db.query('COMMIT');return {id:String(job.id),state:'queued'};
 }catch(error){try{await db.query('ROLLBACK')}catch{}throw error;}finally{db.release();}
}
export async function listPublications(db:QueryableV2,owner:number){
 const rows=(await db.query(`SELECT j.id,j.title,j.state AS job_state,t.id AS target_id,t.platform,t.variant,t.state,t.remote_id,t.last_error_code
  FROM (SELECT * FROM v2_publication_jobs WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30) j
  JOIN v2_publication_targets t ON t.job_id=j.id ORDER BY j.created_at DESC,j.id,t.id`,[owner])).rows;
 const jobs=new Map<string,{id:string;title:string;state:string;targets:Array<{id:string;platform:string;variant:string;state:string;remoteId:string|null;errorCode:string|null}>}>();
 for(const row of rows){
  const id=String(row.id);let job=jobs.get(id);
  if(!job){job={id,title:String(row.title),state:String(row.job_state),targets:[]};jobs.set(id,job);}
  job.targets.push({id:String(row.target_id),platform:String(row.platform),variant:String(row.variant),state:String(row.state),
   remoteId:typeof row.remote_id==='string'?row.remote_id:null,errorCode:typeof row.last_error_code==='string'?row.last_error_code:null});
 }
 for(const job of jobs.values()){
  const states=job.targets.map(t=>t.state);
  job.state=states.every(s=>s==='succeeded')?'succeeded':states.includes('running')?'running':states.includes('needs_review')?'needs_review':
   states.some(s=>['queued','retryable'].includes(s))?'queued':states.includes('failed')?'failed':job.state;
 }
 return [...jobs.values()];
}
export async function retryPublication(db:QueryableV2,owner:number,targetId:string):Promise<boolean>{
 // Ambiguous/completed targets can never be blindly published again.
 const result=await db.query(`WITH changed AS (UPDATE v2_publication_targets t SET state='retryable',next_attempt_at=clock_timestamp(),last_error_code=NULL
  FROM v2_publication_jobs j WHERE j.id=t.job_id AND j.user_id=$1 AND t.id=$2::bigint
   AND t.state IN ('failed','retryable') AND t.attempts<30
   AND EXISTS (SELECT 1 FROM v2_youtube_connections c WHERE c.user_id=j.user_id)
   AND j.audio_file_id IS NOT NULL AND j.cover_file_id IS NOT NULL RETURNING t.id,t.job_id)
  UPDATE v2_publication_jobs j SET state='ready',updated_at=clock_timestamp() FROM changed c
   WHERE j.id=c.job_id RETURNING c.id`,[owner,targetId]);
 return result.rowCount===1;
}
