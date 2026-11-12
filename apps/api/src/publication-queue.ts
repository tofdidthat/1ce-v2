// R03 queue foundation. This module cannot publish externally.
// Only a separately verified media/OAuth workflow may mark drafts READY.
import {createHash,randomUUID} from 'node:crypto';
import type {QueryableV2} from '../../../packages/shared/contracts.js';

export type PublicationPlatform='youtube'|'tiktok'|'instagram'|'telegram'|'discord';
export type PublicationVariant='shorts'|'standard'|'default';
export type PublicationTarget={platform:PublicationPlatform;variant:PublicationVariant};
export type PublicationDraft={
 requestId:string;title:string;description:string;hashtags:string;targets:PublicationTarget[];
};
export type PublicationOutcome='succeeded'|'retryable'|'failed'|'needs_review';
type TxClient=QueryableV2&{release():void};
type TxPool=QueryableV2&{connect():Promise<TxClient>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const platforms=new Set(['youtube','tiktok','instagram','telegram','discord']);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function bounded(v:unknown,max:number,min=0):string {
 if(typeof v!=='string'||v.length>max)throw Error('Invalid publication draft');
 const s=v.trim();if(s.length<min)throw Error('Invalid publication draft');
 return s;
}
export function parsePublicationDraft(value:unknown):PublicationDraft {
 if(!record(value)||typeof value.requestId!=='string'||!uuid.test(value.requestId))
  throw Error('Invalid publication request');
 const title=bounded(value.title,100,1);
 const description=bounded(value.description??'',2000);
 const hashtags=bounded(value.hashtags??'',500);
 if(!Array.isArray(value.targets)||value.targets.length<1||value.targets.length>6)
  throw Error('Invalid publication targets');
 const targets:PublicationTarget[]=[],seen=new Set<string>();
 for(const raw of value.targets){
  if(!record(raw)||!platforms.has(String(raw.platform)))throw Error('Invalid publication target');
  const platform=raw.platform as PublicationPlatform,variant=raw.variant;
  if(typeof variant!=='string'||(platform==='youtube'
   ?!['shorts','standard'].includes(variant):variant!=='default'))
   throw Error('Invalid publication format');
  const key=platform+':'+variant;
  if(seen.has(key))throw Error('Duplicate publication target');
  seen.add(key);targets.push({platform,variant:variant as PublicationVariant});
 }
 targets.sort((a,b)=>(a.platform+':'+a.variant).localeCompare(b.platform+':'+b.variant));
 return {requestId:value.requestId.toLowerCase(),title,description,hashtags,targets};
}
export const publicationRequestHash=(draft:PublicationDraft):string=>
 createHash('sha256').update(JSON.stringify({
  title:draft.title,description:draft.description,hashtags:draft.hashtags,targets:draft.targets
 })).digest('hex');

// Idempotent owner-scoped metadata creation: never queues a publish.
export async function createPublicationDraft(pool:TxPool,ownerId:number,input:unknown):
 Promise<{id:string;created:boolean;state:string;targets:PublicationTarget[]}> {
 if(!Number.isSafeInteger(ownerId)||ownerId<1)throw Error('Invalid owner');
 const draft=parsePublicationDraft(input),fingerprint=publicationRequestHash(draft);
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock($1::bigint)',[ownerId]);
  const saved=await db.query(`INSERT INTO v2_publication_jobs
   (user_id,request_id,request_hash,title,description,hashtags)
   VALUES($1,$2::uuid,$3,$4,$5,$6)
   ON CONFLICT(user_id,request_id) DO NOTHING RETURNING id`,
   [ownerId,draft.requestId,fingerprint,draft.title,draft.description,draft.hashtags]);
  const created=saved.rowCount===1;
  let id=String(saved.rows[0]?.id||''),state='draft';
  if(!created){
   const old=await db.query(`SELECT id,request_hash,state FROM v2_publication_jobs
    WHERE user_id=$1 AND request_id=$2::uuid FOR UPDATE`,[ownerId,draft.requestId]);
   const row=old.rows[0];
   if(!row||row.request_hash!==fingerprint)throw Error('Publication request id already used');
   id=String(row.id);state=String(row.state);
  }else{
   for(const target of draft.targets)await db.query(`INSERT INTO v2_publication_targets
    (job_id,platform,variant) VALUES($1::uuid,$2,$3)`,[id,target.platform,target.variant]);
  }
  await db.query('COMMIT');
  return {id,created,state,targets:draft.targets};
 }catch(error){try{await db.query('ROLLBACK');}catch{}throw error;}
 finally{db.release();}
}
export type ClaimedPublicationTarget={
 id:string;jobId:string;platform:PublicationPlatform;variant:PublicationVariant;
 attempt:number;claimToken:string;
};
// A worker may call this only after verifying destination grants and assets.
// Claims require READY jobs. No server route or background loop invokes it.
export async function claimPublicationTarget(db:QueryableV2):Promise<ClaimedPublicationTarget|null>{
 const token=randomUUID();
 const result=await db.query(`WITH candidate AS MATERIALIZED (
  SELECT t.id FROM v2_publication_targets t
  JOIN v2_publication_jobs j ON j.id=t.job_id
  WHERE j.state='ready' AND t.state IN ('queued','retryable')
   AND t.next_attempt_at<=clock_timestamp() AND t.attempts<30
  ORDER BY t.next_attempt_at,t.id
  LIMIT 1 FOR UPDATE OF t SKIP LOCKED
 ), claimed AS (
  UPDATE v2_publication_targets t SET
   state='running',claim_token=$1::uuid,
   claim_until=clock_timestamp()+interval '2 minutes',
   attempts=t.attempts+1,updated_at=clock_timestamp()
  FROM candidate c WHERE t.id=c.id
  RETURNING t.id,t.job_id,t.platform,t.variant,t.attempts
 ), logged AS (
  INSERT INTO v2_publication_attempts(target_id,attempt,claim_token)
  SELECT id,attempts,$1::uuid FROM claimed RETURNING target_id
 )
 SELECT c.* FROM claimed c JOIN logged l ON l.target_id=c.id`,[token]);
 const row=result.rows[0];if(!row)return null;
 return {id:String(row.id),jobId:String(row.job_id),
  platform:row.platform as PublicationPlatform,variant:row.variant as PublicationVariant,
  attempt:Number(row.attempts),claimToken:token};
}
// Only provider-confirmed success should be marked succeeded.
// Ambiguous timeouts/acknowledgments must go to needs_review, never auto-retry.
export async function settlePublicationTarget(db:QueryableV2,targetId:string,claimToken:string,
 outcome:PublicationOutcome,{remoteId=null,errorCode=null}:{remoteId?:string|null;errorCode?:string|null}={}):Promise<boolean>{
 if(!/^[1-9]\d*$/.test(targetId)||!uuid.test(claimToken))throw Error('Invalid claim');
 if(!['succeeded','retryable','failed','needs_review'].includes(outcome))throw Error('Invalid outcome');
 if(remoteId!==null&&(remoteId.length<1||remoteId.length>120||! /^[A-Za-z0-9_-]+$/.test(remoteId)))
  throw Error('Invalid remote id');
 if(errorCode!==null&&(errorCode.length<1||errorCode.length>64||! /^[a-z0-9_-]+$/.test(errorCode)))
  throw Error('Invalid error code');
 if(outcome==='succeeded'&&!remoteId)throw Error('Provider confirmation required');
 const result=await db.query(`WITH finished AS (
  UPDATE v2_publication_targets t SET
   state=CASE WHEN $3='retryable' AND attempts>=30 THEN 'failed' ELSE $3 END,
   claim_token=NULL,claim_until=NULL,
   remote_id=CASE WHEN $3='succeeded' THEN $4 ELSE remote_id END,
   last_error_code=$5,
   next_attempt_at=CASE WHEN $3='retryable' THEN
    clock_timestamp()+(LEAST(60,POWER(2,LEAST(attempts,6)))::int*interval '1 minute')
    ELSE next_attempt_at END,
   updated_at=clock_timestamp()
  WHERE t.id=$1::bigint AND t.claim_token=$2::uuid AND t.state='running'
   AND t.claim_until>clock_timestamp()
  RETURNING t.id,t.attempts
 ), logged AS (
  UPDATE v2_publication_attempts a SET ended_at=clock_timestamp(),
   outcome=CASE WHEN $3='retryable' AND f.attempts>=30 THEN 'failed' ELSE $3 END,
   remote_id=$4,error_code=$5
  FROM finished f WHERE a.target_id=f.id AND a.attempt=f.attempts
   AND a.claim_token=$2::uuid AND a.ended_at IS NULL
  RETURNING a.target_id
 )
 SELECT target_id FROM logged`,[targetId,claimToken,outcome,remoteId,errorCode]);
 return result.rowCount===1;
}
// Expired provider attempts are ambiguous: they require reconciliation with
// the platform before any additional request, not automatic requeueing.
export async function quarantineExpiredPublicationClaims(db:QueryableV2):Promise<number>{
 const result=await db.query(`WITH expired AS (
  SELECT id,attempts,claim_token FROM v2_publication_targets
  WHERE state='running' AND claim_until<clock_timestamp()
  ORDER BY claim_until,id LIMIT 20 FOR UPDATE SKIP LOCKED
 ), changed AS (
  UPDATE v2_publication_targets t SET state='needs_review',claim_token=NULL,
   claim_until=NULL,last_error_code='claim_expired',updated_at=clock_timestamp()
  FROM expired e WHERE t.id=e.id AND t.claim_token=e.claim_token
  RETURNING t.id,e.attempts,e.claim_token
 ), audit AS (
  UPDATE v2_publication_attempts a SET ended_at=clock_timestamp(),
   outcome='needs_review',error_code='claim_expired'
  FROM changed c WHERE a.target_id=c.id AND a.attempt=c.attempts AND
   a.claim_token=c.claim_token AND a.ended_at IS NULL
  RETURNING a.target_id
 )
 SELECT count(*)::int AS count FROM audit`);
 return Number(result.rows[0]?.count||0);
}
