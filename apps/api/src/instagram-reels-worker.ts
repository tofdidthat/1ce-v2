// Instagram Reels durable worker (R02). OFF by default. Never publishes without
// the per-job explicit public consent AND the server INSTAGRAM_REELS_ENABLED gate.
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {PutObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import type {QueryableV2} from '../../../packages/shared/contracts.js';
import {claimPublicationTarget,settlePublicationTarget} from './publication-queue.js';
import {openPublishing,sealPublishing} from './publishing-secrets.js';
import {PublishingError} from './youtube-connection.js';
import {type InstagramConfig} from './instagram-connection.js';
import {InstagramReelError,createInstagramReel,instagramReelStatus,publishInstagramReel,resolveInstagramPublishingAccount,
 trustedInstagramDeliveryUrl} from './instagram-reels-api.js';
import {type PublishingStorage,downloadPublishingAsset,hashPublishingFile} from './publishing-storage.js';
import {renderPublication} from './publication-renderer.js';

const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
type Options={config:InstagramConfig;storage:PublishingStorage;http?:typeof fetch;render?:typeof renderPublication};
type Connection={generation:string;access_cipher:string;expires_at:string|Date;instagram_user_id:string};
function eligible():boolean{return process.env.INSTAGRAM_REELS_ENABLED==='true';}
export function instagramReelsServerEnabled():boolean{return eligible();}
export async function quarantineExpiredInstagramClaims(db:QueryableV2):Promise<void>{
 // Unlike YouTube resumable uploads, an Instagram media_publish response cannot
 // be safely probed with a resumable offset. Never blindly replay an expired claim.
 await db.query(`WITH stale AS (
  SELECT t.id,t.attempts,t.claim_token FROM v2_publication_targets t
  WHERE t.platform='instagram' AND t.state='running' AND t.claim_until<clock_timestamp()
  ORDER BY t.claim_until LIMIT 10 FOR UPDATE SKIP LOCKED
 ), changed AS (
  UPDATE v2_publication_targets t SET state='needs_review',claim_token=NULL,
   claim_until=NULL,remote_id=COALESCE((SELECT c.published_media_id FROM v2_instagram_checkpoints c
    WHERE c.target_id=t.id),t.remote_id),last_error_code='instagram_claim_expired',updated_at=clock_timestamp()
  FROM stale s WHERE t.id=s.id AND t.claim_token=s.claim_token
  RETURNING t.id,s.attempts,s.claim_token
 ) UPDATE v2_publication_attempts a SET ended_at=clock_timestamp(),
  outcome='needs_review',error_code='instagram_claim_expired'
  FROM changed c WHERE a.target_id=c.id AND a.attempt=c.attempts
   AND a.claim_token=c.claim_token AND a.ended_at IS NULL`);
}
export async function settleConfirmedInstagramReel(db:QueryableV2,targetId:string,claimToken:string,mediaId:string):Promise<void>{
 const settled=await settlePublicationTarget(db,targetId,claimToken,'succeeded',{remoteId:mediaId});
 if(!settled){
  await reconcileConfirmedInstagramReel(db,targetId,claimToken,mediaId);
  throw new PublishingError('instagram_publish_needs_review',409);
 }
}
async function reconcileConfirmedInstagramReel(db:QueryableV2,targetId:string,claimToken:string,mediaId:string):Promise<void>{
 // A lease can expire or deauth can quarantine a target while Meta responds.
 // Preserve the confirmation against the original attempt, without reclaiming
 // work, changing succeeded targets, or making another provider request.
 await db.query(`WITH confirmation AS (
  UPDATE v2_instagram_checkpoints c SET published_media_id=$3,updated_at=clock_timestamp()
  WHERE c.target_id=$1::bigint AND c.publish_started_at IS NOT NULL
   AND (c.published_media_id IS NULL OR c.published_media_id=$3)
   AND EXISTS (SELECT 1 FROM v2_publication_attempts a WHERE a.target_id=c.target_id AND a.claim_token=$2::uuid)
  RETURNING c.target_id
 ), reconciled AS (
  UPDATE v2_publication_targets t SET state='needs_review',remote_id=$3,claim_token=NULL,claim_until=NULL,
   last_error_code='instagram_publish_needs_review',updated_at=clock_timestamp()
  FROM confirmation c WHERE t.id=c.target_id AND t.platform='instagram'
   AND (t.remote_id IS NULL OR t.remote_id=$3)
   AND ((t.state='running' AND t.claim_token=$2::uuid) OR t.state='needs_review')
  RETURNING t.id
 ) UPDATE v2_publication_attempts a SET ended_at=COALESCE(ended_at,clock_timestamp()),
  outcome='needs_review',remote_id=$3,error_code='instagram_publish_needs_review'
  FROM reconciled r WHERE a.target_id=r.id AND a.claim_token=$2::uuid`,[targetId,claimToken,mediaId]);
}
async function loadInstagramAccess(db:QueryableV2,owner:number,generation:string,config:InstagramConfig,
 http:typeof fetch):Promise<{accessToken:string;accountId:string}>{
 const load=async()=>((await db.query(`SELECT generation,access_cipher,expires_at,instagram_user_id
  FROM v2_instagram_connections WHERE user_id=$1 AND generation=$2::uuid`,[owner,generation])).rows[0]||null) as Connection|null;
 let row=await load();
 if(!row)throw new PublishingError('instagram_reconnect_required',409);
 let token=openPublishing(String(row.access_cipher),'instagram-access:'+owner,config.encryptionSecret);
 let expiry=new Date(row.expires_at).getTime();
 if(expiry-Date.now()<7*86400000){
  // Conditional refresh preserves the connection generation so queued jobs
  // remain bound to the same authorized Instagram account.
  try{
   const url=new URL('https://graph.instagram.com/refresh_access_token');
   // This token endpoint documents GET query credentials, unlike Graph resource
   // calls (Bearer header). External tracing must omit this URL's query.
   url.search=new URLSearchParams({grant_type:'ig_refresh_token',access_token:token}).toString();
   const response=await http(url.href,{redirect:'error',signal:AbortSignal.timeout(20000)});
   const data:unknown=await response.json().catch(()=>null);
   const v=data&&typeof data==='object'?data as Record<string,unknown>:null;
   const seconds=Number(v?.expires_in);
   if(response.ok&&v&&typeof v.access_token==='string'&&v.access_token.length>0&&
    v.access_token.length<=8192&&Number.isSafeInteger(seconds)&&seconds>3600&&seconds<=7776000){
    const cipher=sealPublishing(v.access_token,'instagram-access:'+owner,config.encryptionSecret);
    const result=await db.query(`UPDATE v2_instagram_connections SET access_cipher=$4,
     expires_at=clock_timestamp()+($5::int*interval '1 second'),updated_at=clock_timestamp()
     WHERE user_id=$1 AND generation=$2::uuid AND access_cipher=$3 RETURNING generation`,
    [owner,generation,row.access_cipher,cipher,seconds]);
    if(result.rowCount===1){token=v.access_token;expiry=Date.now()+seconds*1000;}
    else{
     row=await load();if(!row)throw new PublishingError('instagram_reconnect_required',409);
     token=openPublishing(String(row.access_cipher),'instagram-access:'+owner,config.encryptionSecret);
     expiry=new Date(row.expires_at).getTime();
    }
   }
  }catch{/* A still-valid token can be used; expired ones cannot. */}
 }
 if(!row)throw new PublishingError('instagram_reconnect_required',409);
 if(!Number.isFinite(expiry)||expiry<Date.now()+30*60000)
  throw new PublishingError('instagram_reconnect_required',409);
 if(!/^[0-9]{1,32}$/.test(String(row.instagram_user_id)))
  throw new PublishingError('instagram_identity_mismatch',409);
 return {accessToken:token,accountId:String(row.instagram_user_id)};
}
export async function runInstagramReelOnce(db:QueryableV2,{config,storage,http=fetch,render=renderPublication}:Options):Promise<boolean>{
 if(!eligible())return false;
 const target=await claimPublicationTarget(db,'instagram');if(!target)return false;
 const args=[target.id,target.claimToken],controller=new AbortController();
 let heartBusy=false,dir='',artifactKey:string|null=null,publishStarted=false,confirmedMediaId:string|null=null;
 const heartbeat=setInterval(()=>{
  if(heartBusy)return;heartBusy=true;
  void db.query(`UPDATE v2_publication_targets SET claim_until=clock_timestamp()+interval '2 minutes'
   WHERE id=$1::bigint AND claim_token=$2::uuid AND state='running'
   AND claim_until>clock_timestamp() RETURNING id`,args).then(
    r=>{if(r.rowCount!==1)controller.abort()},()=>controller.abort()
   ).finally(()=>{heartBusy=false});
 },20000);
 try{
  const job=(await db.query('SELECT * FROM v2_publication_jobs WHERE id=$1::uuid',[target.jobId])).rows[0];
  if(!job||!job.audio_file_id||!job.cover_file_id||job.instagram_public_confirmed!==true||
   !job.instagram_generation)throw new PublishingError('instagram_public_consent_required',409);
  const owner=Number(job.user_id),generation=String(job.instagram_generation);
  const auth=await loadInstagramAccess(db,owner,generation,config,http);
  const publishingAccountId=await resolveInstagramPublishingAccount({
   token:auth.accessToken,oauthUserId:auth.accountId,http
  });
  const fence=async()=>{
   controller.signal.throwIfAborted();
   if(!eligible())throw new PublishingError('instagram_reels_not_enabled',503);
   const r=await db.query(`SELECT t.id FROM v2_publication_targets t
    JOIN v2_publication_jobs j ON j.id=t.job_id
    JOIN v2_instagram_connections i ON i.user_id=j.user_id AND i.generation=j.instagram_generation
    WHERE t.id=$1::bigint AND t.claim_token=$2::uuid AND t.platform='instagram'
     AND t.state='running' AND t.claim_until>clock_timestamp()
     AND j.state='ready' AND j.instagram_public_confirmed=true
     AND j.audio_file_id IS NOT NULL AND j.cover_file_id IS NOT NULL`,args);
   if(r.rowCount!==1)throw new PublishingError('publication_connection_changed',409);
  };
  await fence();
  const files=(await db.query(`SELECT id,kind,object_key,byte_size,sha256 FROM library_files
   WHERE user_id=$1 AND status='ready' AND
    ((id=$2 AND kind='audio') OR (id=$3 AND kind='cover'))`,
  [owner,job.audio_file_id,job.cover_file_id])).rows;
  const audio=files.find(f=>f.kind==='audio'),cover=files.find(f=>f.kind==='cover');
  if(!audio||!cover)throw new PublishingError('source_media_missing',404);
  dir=await mkdtemp(join(tmpdir(),'onece-publish-'));
  const output=join(dir,'instagram-reel.mp4');
  let checkpoint=(await db.query('SELECT * FROM v2_instagram_checkpoints WHERE target_id=$1::bigint',[target.id])).rows[0];
  let bytes:number,sha:string;
  if(checkpoint){
   if(String(checkpoint.connection_generation)!==generation)throw new PublishingError('publication_connection_changed',409);
   artifactKey=String(checkpoint.artifact_key);bytes=Number(checkpoint.artifact_bytes);sha=String(checkpoint.artifact_sha);
   if(!artifactKey.startsWith('publishing/users/'+owner+'/'+target.jobId+'/'+target.id+'/')||
    !artifactKey.endsWith('/'+sha+'.mp4')||!/^[a-f0-9]{64}$/.test(sha))
    throw new PublishingError('checkpoint_invalid',409);
   publishStarted=!!checkpoint.publish_started_at;
   if(publishStarted)throw new PublishingError('instagram_publish_needs_review',409);
   await downloadPublishingAsset(storage,artifactKey,output,bytes,sha,controller.signal);
  }else{
   const audioPath=join(dir,/\.wav$/i.test(String(audio.object_key))?'audio.wav':'audio.mp3'),coverPath=join(dir,'cover.image');
   await downloadPublishingAsset(storage,String(audio.object_key),audioPath,Number(audio.byte_size),
    typeof audio.sha256==='string'?audio.sha256:null,controller.signal);
   await downloadPublishingAsset(storage,String(cover.object_key),coverPath,Number(cover.byte_size),
    typeof cover.sha256==='string'?cover.sha256:null,controller.signal);
   await render({audio:audioPath,cover:coverPath,output,variant:'shorts',signal:controller.signal,
    audioBitrate:'128k',audioSampleRate:48000});
   await fence();bytes=(await stat(output)).size;sha=await hashPublishingFile(output);
   artifactKey=`publishing/users/${owner}/${target.jobId}/${target.id}/${sha}.mp4`;
   await db.query(`INSERT INTO v2_publication_artifacts(object_key,user_id) VALUES($1,$2)
    ON CONFLICT(object_key) DO UPDATE SET expires_at=clock_timestamp()+interval '7 days'`,[artifactKey,owner]);
   const stream=createReadStream(output);
   try{await storage.s3.send(new PutObjectCommand({Bucket:storage.bucket,Key:artifactKey,Body:stream,
    ContentLength:bytes,ContentType:'video/mp4'}),{abortSignal:controller.signal})}finally{stream.destroy();}
   await fence();
   await db.query(`INSERT INTO v2_instagram_checkpoints
    (target_id,connection_generation,artifact_key,artifact_sha,artifact_bytes)
    SELECT t.id,$3::uuid,$4,$5,$6 FROM v2_publication_targets t
    WHERE t.id=$1::bigint AND t.claim_token=$2::uuid AND t.state='running'
    AND t.claim_until>clock_timestamp() ON CONFLICT(target_id) DO NOTHING`,
   [...args,generation,artifactKey,sha,bytes]);
   checkpoint=(await db.query('SELECT * FROM v2_instagram_checkpoints WHERE target_id=$1::bigint',[target.id])).rows[0];
   if(!checkpoint||String(checkpoint.artifact_sha)!==sha)throw new PublishingError('checkpoint_not_saved',503);
  }
  await db.query("UPDATE v2_publication_artifacts SET expires_at=clock_timestamp()+interval '7 days' WHERE object_key=$1",[artifactKey]);
  const apiOrigin=new URL(config.redirectUri).origin;
  let containerId=checkpoint.container_id?String(checkpoint.container_id):'';
  if(!containerId){
   // A random, never-logged 256-bit capability grants Meta access only to this
   // temporary rendered MP4. The DB contains only its SHA-256.
   const capability=randomBytes(32).toString('base64url');
   const delivery=trustedInstagramDeliveryUrl(apiOrigin+'/api/publishing/meta-media?token='+capability,apiOrigin);
   await db.query(`INSERT INTO v2_instagram_media_grants(target_id,token_hash,expires_at)
    VALUES($1::bigint,$2,clock_timestamp()+interval '60 minutes')
    ON CONFLICT(target_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at`,
   [target.id,hash(capability)]);
   await fence();
   containerId=await createInstagramReel({accountId:publishingAccountId,token:auth.accessToken,
    videoUrl:delivery,apiOrigin,caption:[job.title,job.description,job.hashtags].filter(Boolean).join('\n\n').slice(0,2200),http});
   await fence();
   const saved=await db.query(`UPDATE v2_instagram_checkpoints c SET container_id=$3,
    updated_at=clock_timestamp() FROM v2_publication_targets t
    WHERE c.target_id=t.id AND t.id=$1::bigint AND t.claim_token=$2::uuid
    AND t.state='running' AND t.claim_until>clock_timestamp()
    AND c.container_id IS NULL RETURNING c.target_id`,[...args,containerId]);
   if(saved.rowCount!==1)throw new PublishingError('checkpoint_not_saved',503);
  }
  let finished=false;
  for(let attempt=0;attempt<72;attempt++){
   await fence();
   const state=await instagramReelStatus({containerId,token:auth.accessToken,http});
   if(state==='FINISHED'){finished=true;break;}
   if(state==='ERROR'||state==='EXPIRED')throw new PublishingError('instagram_reel_processing_failed',422);
   if(attempt<71)await delay(10000,undefined,{signal:controller.signal});
  }
  if(!finished)throw new PublishingError('instagram_reel_processing_timeout',503);
  await fence();
  // Durable irreversible boundary: after this write, any failure or worker
  // crash MUST go to needs_review; never automatically call media_publish twice.
  const marked=await db.query(`UPDATE v2_instagram_checkpoints c SET publish_started_at=clock_timestamp(),
   updated_at=clock_timestamp() FROM v2_publication_targets t
   WHERE c.target_id=t.id AND t.id=$1::bigint AND t.claim_token=$2::uuid
   AND t.state='running' AND t.claim_until>clock_timestamp() AND c.publish_started_at IS NULL
   RETURNING c.target_id`,args);
  if(marked.rowCount!==1)throw new PublishingError('instagram_publish_needs_review',409);
  publishStarted=true;
  const mediaId=await publishInstagramReel({accountId:publishingAccountId,containerId,token:auth.accessToken,http});
  confirmedMediaId=mediaId;
  await db.query('UPDATE v2_instagram_checkpoints SET published_media_id=$2,updated_at=clock_timestamp() WHERE target_id=$1::bigint',
   [target.id,mediaId]);
  await settleConfirmedInstagramReel(db,target.id,target.claimToken,mediaId);
  await db.query('DELETE FROM v2_instagram_media_grants WHERE target_id=$1::bigint',[target.id]);
  if(artifactKey){
   try{await storage.s3.send(new DeleteObjectCommand({Bucket:storage.bucket,Key:artifactKey}));
    await db.query('DELETE FROM v2_publication_artifacts WHERE object_key=$1',[artifactKey]);}
   catch{ /* The scheduled orphan cleaner will remove this rendered-only artifact. */ }
  }
 }catch(error){
  const code=error instanceof PublishingError?error.code:
   error instanceof InstagramReelError?error.code:'instagram_temporarily_unavailable';
  const permanent=(error instanceof PublishingError&&[400,404,422].includes(error.status))||
   (error instanceof InstagramReelError&&!error.retryable)||code==='instagram_reconnect_required';
  const review=publishStarted||code==='instagram_publish_needs_review'||code==='publication_connection_changed'||code==='checkpoint_invalid';
  const settled=await settlePublicationTarget(db,target.id,target.claimToken,review?'needs_review':permanent?'failed':'retryable',
   {errorCode:code,remoteId:confirmedMediaId});
  if(!settled&&confirmedMediaId)await reconcileConfirmedInstagramReel(db,target.id,target.claimToken,confirmedMediaId);
 }finally{
  clearInterval(heartbeat);controller.abort();
  if(dir&&dirname(resolve(dir))===resolve(tmpdir())&&basename(dir).startsWith('onece-publish-'))
   await rm(dir,{recursive:true,force:true});
  await db.query(`UPDATE v2_publication_jobs j SET state=CASE
   WHEN NOT EXISTS (SELECT 1 FROM v2_publication_targets t WHERE t.job_id=j.id AND t.state<>'succeeded') THEN 'succeeded'
   ELSE 'failed' END,updated_at=clock_timestamp() WHERE j.id=$1::uuid
   AND NOT EXISTS (SELECT 1 FROM v2_publication_targets t WHERE t.job_id=j.id AND t.state IN ('queued','retryable','running','draft'))`,[target.jobId]);
 }
 return true;
}
