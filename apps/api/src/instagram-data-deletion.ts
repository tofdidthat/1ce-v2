import {createHash} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {DeleteObjectCommand} from '@aws-sdk/client-s3';
import type {QueryableV2} from '../../../packages/shared/contracts.js';
import type {PublishingPool} from './publishing-jobs.js';
import type {PublishingStorage} from './publishing-storage.js';

export const deletionCodeHash=(code:string)=>createHash('sha256').update(code).digest('hex');

export async function scheduleInstagramDataDeletion(db:QueryableV2,requestHash:string,code:string,subjectHash:string,
 metaUserId:string):Promise<boolean|'unresolved'>{
 const existing=await db.query('SELECT request_hash FROM v2_instagram_data_deletions WHERE request_hash=$1',[requestHash]);
 if(existing.rowCount)return true; // Replays never erase a later connection.
 const matched=await db.query(`SELECT user_id FROM v2_instagram_connections WHERE instagram_user_id=$1
  UNION SELECT user_id FROM v2_instagram_compliance_subjects WHERE instagram_user_id_hash=$2`,[metaUserId,subjectHash]);
 const owners=[...new Set(matched.rows.map(row=>Number(row.user_id)).filter(id=>Number.isSafeInteger(id)&&id>0))].sort((a,b)=>a-b);
 if(!owners.length){
  // Pre-migration disconnects may have removed the only identity mapping.
  // Never claim those V2 records were erased based on a v1 acknowledgement.
  const unmapped=await db.query(`SELECT 1 FROM v2_publication_jobs j WHERE j.instagram_generation IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM v2_instagram_connections c WHERE c.user_id=j.user_id)
   AND NOT EXISTS(SELECT 1 FROM v2_instagram_compliance_subjects s WHERE s.user_id=j.user_id) LIMIT 1`);
  return unmapped.rowCount?'unresolved':false;
 }
 // Same lock as enqueue and OAuth storage: deletion and a new connection/job
 // cannot pass each other. Callers own the enclosing transaction.
 for(const owner of owners)await db.query('SELECT pg_advisory_xact_lock($1::bigint)',[owner]);
 await db.query(`INSERT INTO v2_instagram_data_deletions(request_hash,confirmation_hash,owners)
  VALUES($1,$2,$3::integer[])`,[requestHash,deletionCodeHash(code),owners]);
 await db.query('DELETE FROM v2_instagram_oauth WHERE user_id=ANY($1::integer[])',[owners]);
 await db.query(`UPDATE v2_publication_targets t SET state='needs_review',claim_token=NULL,claim_until=NULL,
  last_error_code='instagram_data_deletion_pending',updated_at=clock_timestamp()
  FROM v2_publication_jobs j WHERE j.id=t.job_id AND j.user_id=ANY($1::integer[])
   AND t.platform='instagram' AND t.state IN ('queued','retryable','running','draft')`,[owners]);
 await db.query('DELETE FROM v2_instagram_connections WHERE user_id=ANY($1::integer[])',[owners]);
 return true;
}

export async function serveInstagramDataDeletionStatus(req:IncomingMessage,res:ServerResponse,url:URL,db:QueryableV2):Promise<void>{
 const code=url.searchParams.get('code')||'';
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
 if(req.method!=='GET'||[...url.searchParams.keys()].length!==1||! /^[a-f0-9]{32}$/.test(code)){
  res.writeHead(404,headers);res.end(JSON.stringify({error:'not_found'}));return;
 }
 const row=(await db.query(`SELECT d.completed_at,r.legacy_response IS NOT NULL AS legacy_completed
  FROM v2_instagram_data_deletions d JOIN v2_instagram_compliance_receipts r ON r.request_hash=d.request_hash
  WHERE d.confirmation_hash=$1`,[deletionCodeHash(code)])).rows[0];
 res.writeHead(row?200:404,headers);
 res.end(JSON.stringify(row?{status:row.completed_at&&row.legacy_completed?'completed':'pending'}:{error:'not_found'}));
}

// Small, retryable batches. Never acknowledge completion before successful R2
// deletes and the database commit. A failed commit can repeat DeleteObject,
// which is idempotent. No originals or provider-side posts are deleted here.
export async function processInstagramDataDeletionOnce(pool:PublishingPool,storage:PublishingStorage|null):Promise<boolean>{
 const db=await pool.connect();
 let requestHash:string|null=null;
 try{
  await db.query('BEGIN');
  const request=(await db.query(`SELECT request_hash,owners FROM v2_instagram_data_deletions
   WHERE completed_at IS NULL AND not_before<=clock_timestamp()
   ORDER BY not_before,request_hash LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
  if(!request){await db.query('COMMIT');return false;}
  requestHash=String(request.request_hash);
  const owners=request.owners as number[];
  for(const owner of [...owners].sort((a,b)=>a-b)){
   const lock=(await db.query('SELECT pg_try_advisory_xact_lock($1::bigint) AS locked',[owner])).rows[0];
   if(!lock?.locked){await db.query('ROLLBACK');return false;}
  }
  const keys=(await db.query(`WITH candidates AS (
   SELECT j.user_id,j.id AS job_id,t.id AS target_id,c.artifact_key AS object_key
   FROM v2_instagram_checkpoints c JOIN v2_publication_targets t ON t.id=c.target_id
   JOIN v2_publication_jobs j ON j.id=t.job_id WHERE t.platform='instagram' AND j.user_id=ANY($1::integer[])
   UNION
   SELECT j.user_id,j.id,t.id,a.object_key FROM v2_publication_artifacts a
   JOIN v2_publication_jobs j ON j.user_id=a.user_id
   JOIN v2_publication_targets t ON t.job_id=j.id AND t.platform='instagram'
   WHERE j.user_id=ANY($1::integer[]) AND a.object_key LIKE
    'publishing/users/'||j.user_id||'/'||j.id||'/'||t.id||'/%'
  ) SELECT c.*,EXISTS(SELECT 1 FROM v2_youtube_checkpoints y WHERE y.artifact_key=c.object_key) AS shared
   FROM candidates c ORDER BY object_key LIMIT 5`,[owners])).rows;
  for(const row of keys){
   const key=String(row.object_key),prefix=`publishing/users/${row.user_id}/${row.job_id}/${row.target_id}/`;
   if(!storage||row.shared||!key.startsWith(prefix)||! /^[a-f0-9]{64}\.mp4$/.test(key.slice(prefix.length)))
    throw Error('Instagram deletion artifact unavailable or unsafe');
   await storage.s3.send(new DeleteObjectCommand({Bucket:storage.bucket,Key:key}),{abortSignal:AbortSignal.timeout(15000)});
   await db.query('DELETE FROM v2_publication_artifacts WHERE object_key=$1 AND user_id=$2',[key,row.user_id]);
   await db.query(`DELETE FROM v2_instagram_checkpoints WHERE target_id=$1::bigint AND artifact_key=$2`,[row.target_id,key]);
  }
  if(keys.length){await db.query('COMMIT');return true;}
  // Keep mixed-platform jobs and all their non-Instagram targets/checkpoints.
  await db.query(`DELETE FROM v2_publication_jobs j WHERE j.user_id=ANY($1::integer[])
   AND EXISTS(SELECT 1 FROM v2_publication_targets t WHERE t.job_id=j.id AND t.platform='instagram')
   AND NOT EXISTS(SELECT 1 FROM v2_publication_targets t WHERE t.job_id=j.id AND t.platform<>'instagram')`,[owners]);
  await db.query(`DELETE FROM v2_publication_targets t USING v2_publication_jobs j
   WHERE j.id=t.job_id AND j.user_id=ANY($1::integer[]) AND t.platform='instagram'`,[owners]);
  await db.query(`DELETE FROM v2_publication_jobs j WHERE j.user_id=ANY($1::integer[])
   AND j.instagram_generation IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM v2_publication_targets t WHERE t.job_id=j.id)`,[owners]);
  await db.query(`UPDATE v2_publication_jobs SET instagram_generation=NULL,instagram_public_confirmed=false
   WHERE user_id=ANY($1::integer[]) AND instagram_generation IS NOT NULL`,[owners]);
  await db.query('DELETE FROM v2_instagram_oauth WHERE user_id=ANY($1::integer[])',[owners]);
  await db.query('DELETE FROM v2_instagram_connections WHERE user_id=ANY($1::integer[])',[owners]);
  await db.query('DELETE FROM v2_instagram_compliance_subjects WHERE user_id=ANY($1::integer[])',[owners]);
  await db.query(`UPDATE v2_instagram_data_deletions SET owners='{}'::integer[],completed_at=clock_timestamp()
   WHERE request_hash=$1`,[request.request_hash]);
  await db.query('COMMIT');return true;
 }catch(error){
  try{await db.query('ROLLBACK')}catch{}
  // A bad artifact or a failing bucket must not starve other owners' requests.
  if(requestHash)try{await db.query(`UPDATE v2_instagram_data_deletions
   SET not_before=clock_timestamp()+interval '1 minute' WHERE request_hash=$1 AND completed_at IS NULL`,[requestHash])}catch{}
  throw error;
 }
 finally{db.release();}
}
