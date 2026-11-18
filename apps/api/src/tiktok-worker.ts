import {createHash,randomBytes} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PutObjectCommand} from '@aws-sdk/client-s3';
import type {PublishingPool} from './publishing-jobs.js';
import {claimPublicationTarget,settlePublicationTarget} from './publication-queue.js';
import {tikTokAccess,type TikTokConfig} from './tiktok-connection.js';
import {deliveryEndpoint,draftMaxDurationSec,parseTikTokDraftConsent,TikTokDraftRejected,tikTokPost} from './tiktok-draft-upload.js';
import {downloadPublishingAsset,hashPublishingFile,type PublishingStorage} from './publishing-storage.js';
import {renderPublication,validateTikTokDuration} from './publication-renderer.js';
import {PublishingError} from './youtube-connection.js';

type Options={config:TikTokConfig;storage:PublishingStorage;http?:typeof fetch;render?:typeof renderPublication;
 validateDuration?:typeof validateTikTokDuration};
export async function recoverTikTokClaims(db:PublishingPool) {
 await db.query(`WITH stale AS (
  SELECT t.id,t.claim_token,t.attempts FROM v2_publication_targets t
  WHERE t.platform='tiktok' AND t.state='running' AND t.claim_until<clock_timestamp()
  ORDER BY t.claim_until LIMIT 10 FOR UPDATE SKIP LOCKED
 ), changed AS (
  UPDATE v2_publication_targets t SET state=CASE WHEN s.attempts>=30 OR EXISTS
   (SELECT 1 FROM v2_tiktok_checkpoints c WHERE c.target_id=t.id AND c.publish_id IS NULL)
   THEN 'needs_review' ELSE 'retryable' END, claim_until=NULL,claim_token=NULL,
   last_error_code='worker_restarted',next_attempt_at=clock_timestamp() FROM stale s
   WHERE t.id=s.id AND t.claim_token=s.claim_token RETURNING t.id,s.claim_token,t.state
 ) UPDATE v2_publication_attempts a SET ended_at=clock_timestamp(),outcome=c.state,error_code='worker_restarted'
 FROM changed c WHERE a.target_id=c.id AND a.claim_token=c.claim_token AND a.ended_at IS NULL`);
 // Also finishes jobs whose last target was quarantined during a restart.
 await db.query(`UPDATE v2_publication_jobs j SET state='failed',updated_at=clock_timestamp()
  WHERE j.state='ready' AND EXISTS (SELECT 1 FROM v2_publication_targets t WHERE t.job_id=j.id
   AND t.platform='tiktok' AND t.state IN ('needs_review','failed'))
  AND NOT EXISTS (SELECT 1 FROM v2_publication_targets t WHERE t.job_id=j.id AND t.state IN ('queued','retryable','running','draft'))`);
}

export async function runTikTokOnce(db:PublishingPool,{storage,config,http=fetch,render=renderPublication,
 validateDuration=validateTikTokDuration}:Options) {
 const endpoint=deliveryEndpoint();
 if(!endpoint)return false;
 const target=await claimPublicationTarget(db,'tiktok');
 if(!target)return false;
 const args=[target.id,target.claimToken], controller=new AbortController();
 let directory='',started=false,publishId='';
 const heartbeat=setInterval(()=>{
  void db.query(`UPDATE v2_publication_targets SET claim_until=clock_timestamp()+interval '2 minutes'
   WHERE id=$1 AND claim_token=$2 AND state='running' AND claim_until>clock_timestamp()`,args)
   .then(r=>{if(!r.rowCount)controller.abort();},()=>controller.abort());
 },20000);
 try {
  const job=(await db.query('SELECT * FROM v2_publication_jobs WHERE id=$1',[target.jobId])).rows[0];
  const cp=(await db.query('SELECT publish_id FROM v2_tiktok_checkpoints WHERE target_id=$1',[target.id])).rows[0];
  started=!!cp;
  publishId=cp?.publish_id?String(cp.publish_id):'';
  const prefs=parseTikTokDraftConsent(job?.tiktok_preferences);
  const owner=Number(job.user_id);
  const access=()=>tikTokAccess(db,owner,config,http,prefs.connectionId);
  let auth=await access();
  if(cp){
   if(!cp.publish_id)throw new PublishingError('tiktok_init_uncertain',409);
   publishId=String(cp.publish_id);
  }else{
   const files=(await db.query(`SELECT kind,object_key,byte_size,sha256 FROM library_files WHERE user_id=$1 AND status='ready'
    AND ((id=$2 AND kind='audio') OR (id=$3 AND kind='cover'))`,[owner,job.audio_file_id,job.cover_file_id])).rows;
   const audio=files.find(f=>f.kind==='audio'), cover=files.find(f=>f.kind==='cover');
   if(!audio||!cover)throw new PublishingError('source_media_missing',404);
   directory=await mkdtemp(join(tmpdir(),'onece-tiktok-'));
   const output=join(directory,'video.mp4'), audioPath=join(directory,/\.wav$/i.test(String(audio.object_key))?'audio.wav':'audio.mp3');
   const coverPath=join(directory,'cover.image');
   for(const [asset,path] of [[audio,audioPath],[cover,coverPath]] as const)
    await downloadPublishingAsset(storage,String(asset.object_key),path,Number(asset.byte_size),
     typeof asset.sha256==='string'?asset.sha256:null,controller.signal);
   await render({audio:audioPath,cover:coverPath,output,variant:'vertical',maxDurationSec:draftMaxDurationSec,signal:controller.signal});
   await validateDuration(output,draftMaxDurationSec,controller.signal);
   const sha=await hashPublishingFile(output),bytes=(await stat(output)).size;
   if(bytes<1||bytes>256*1024*1024)throw new PublishingError('render_limit_exceeded',422);
   const key='publishing/users/'+owner+'/'+target.jobId+'/'+target.id+'/'+sha+'.mp4';
   await db.query(`INSERT INTO v2_publication_artifacts(object_key,user_id) VALUES($1,$2)
    ON CONFLICT(object_key) DO UPDATE SET expires_at=clock_timestamp()+interval '7 days'`,[key,owner]);
   const stream=createReadStream(output);
   try{
    await storage.s3.send(new PutObjectCommand({Key:key,Bucket:storage.bucket,Body:stream,ContentType:'video/mp4',ContentLength:bytes}),
     {abortSignal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)])});
   }finally{stream.destroy();}
   auth=await access();
   const capability=randomBytes(32).toString('base64url');
   const marker=await db.query(`INSERT INTO v2_tiktok_checkpoints(target_id,init_claim,connection_generation,
    artifact_key,artifact_sha,artifact_bytes,token_hash,expires_at)
    SELECT t.id,t.claim_token,c.generation,$4,$5,$6,$7,clock_timestamp()+interval '1 hour'
    FROM v2_publication_targets t JOIN v2_publication_jobs j ON j.id=t.job_id
    JOIN v2_tiktok_connections c ON c.user_id=j.user_id AND c.generation=$3::uuid
    WHERE t.id=$1 AND t.claim_token=$2 AND t.state='running' AND t.claim_until>clock_timestamp()
    AND j.state='ready' AND j.audio_file_id IS NOT NULL AND j.cover_file_id IS NOT NULL
    AND 'video.upload'=ANY(regexp_split_to_array(trim(c.scope),'[[:space:]]*,[[:space:]]*'))
    FOR UPDATE OF t FOR SHARE OF c ON CONFLICT(target_id) DO NOTHING RETURNING target_id`,
    [...args,auth.generation,key,sha,bytes,createHash('sha256').update(capability).digest('hex')]);
   if(!marker.rowCount)throw new PublishingError('tiktok_connection_changed',409);
   started=true;
   controller.signal.throwIfAborted();
   if(deliveryEndpoint()!==endpoint)throw new PublishingError('tiktok_draft_upload_disabled',503);
   const data=await tikTokPost('inbox/video/init',auth.token,{
    source_info:{source:'PULL_FROM_URL',video_url:endpoint+'?token='+capability}
   },http);
   if(typeof data.publish_id!=='string'||!validPublishId(data.publish_id))throw new PublishingError('tiktok_init_uncertain',409);
   publishId=data.publish_id;
   const saved=await db.query(`UPDATE v2_tiktok_checkpoints SET publish_id=$3 WHERE target_id=$1 AND init_claim=$2
    AND publish_id IS NULL RETURNING target_id`,[...args,publishId]);
   if(!saved.rowCount)throw new PublishingError('tiktok_checkpoint_failed',409);
  }
  const result=await tikTokPost('status/fetch',auth.token,{publish_id:publishId},http);
  if(result.status==='SEND_TO_USER_INBOX'||result.status==='PUBLISH_COMPLETE'){
   await settlePublicationTarget(db,target.id,target.claimToken,'succeeded',{remoteId:publishId});
  }else if(result.status==='PROCESSING_DOWNLOAD'||result.status==='PROCESSING_UPLOAD'){
   await settlePublicationTarget(db,target.id,target.claimToken,target.attempt>=30?'needs_review':'retryable',
    {errorCode:'tiktok_processing'});
  }else{
   const knownFailures=['video_pull_failed','file_format_check_failed','duration_check_failed','picture_size_check_failed',
    'spam_risk_too_many_posts','auth_removed','publish_cancelled'];
   const reason=knownFailures.includes(String(result.fail_reason))?'tiktok_'+result.fail_reason:'tiktok_draft_failed';
   await settlePublicationTarget(db,target.id,target.claimToken,result.status==='FAILED'?'failed':'needs_review',
    {errorCode:result.status==='FAILED'?reason:'tiktok_status_unknown',remoteId:publishId});
  }
 } catch(error){
  if (error instanceof TikTokDraftRejected && started && !publishId) {
   const cleared=await db.query(`DELETE FROM v2_tiktok_checkpoints c USING v2_publication_targets t
    WHERE c.target_id=$1 AND c.init_claim=$2 AND c.publish_id IS NULL AND t.id=c.target_id
     AND t.claim_token=$2 AND t.state='running' AND t.claim_until>clock_timestamp()`,args);
   if(cleared.rowCount===1)started=false;
  }
  const code=error instanceof PublishingError?error.code:'tiktok_temporarily_unavailable';
  const transient=!(error instanceof PublishingError)||error.status>=500||error.status===429;
  const review=code==='tiktok_connection_changed'||(started&&(!publishId||!transient||target.attempt>=30));
  await settlePublicationTarget(db,target.id,target.claimToken,review?'needs_review':transient?'retryable':'failed',
   {remoteId:publishId||null,errorCode:code});
 } finally {
  clearInterval(heartbeat);controller.abort();
  if(directory)await rm(directory,{recursive:true,force:true});
  await db.query(`UPDATE v2_publication_jobs j SET state=CASE WHEN NOT EXISTS
   (SELECT 1 FROM v2_publication_targets t WHERE t.job_id=j.id AND t.state<>'succeeded') THEN 'succeeded' ELSE 'failed' END,
   updated_at=clock_timestamp() WHERE j.id=$1 AND NOT EXISTS
   (SELECT 1 FROM v2_publication_targets t WHERE t.job_id=j.id AND t.state IN ('queued','retryable','running','draft'))`,[target.jobId]);
 }
 return true;
}
function validPublishId(id:string){return /^[A-Za-z0-9_.~-]{1,120}$/.test(id);}
