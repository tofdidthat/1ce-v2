import {mkdtemp,rm,stat,open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {PutObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import type {QueryableV2} from '../../../packages/shared/contracts.js';
import {claimPublicationTarget,settlePublicationTarget} from './publication-queue.js';
import {beginYouTubeUpload,probeYouTubeUpload,sendYouTubeChunk} from './youtube-resumable.js';
import {youtubeAccess,PublishingError} from './youtube-connection.js';
import {publishingConfig,openPublishing,sealPublishing,type PublishingConfig} from './publishing-secrets.js';
import {publishingStorage,downloadPublishingAsset,hashPublishingFile,type PublishingStorage} from './publishing-storage.js';
import {renderPublication,publicationRendererAvailable} from './publication-renderer.js';
import {ensurePublishingSchema} from './publishing-schema.js';
type WorkerOptions={storage:PublishingStorage;config:PublishingConfig;http?:typeof fetch;render?:typeof renderPublication};
export async function recoverYouTubeClaims(db:QueryableV2):Promise<void>{
 // Only this pipeline's YouTube jobs: no bytes can be sent until the session
 // capability has been persisted. Recovery always PROBES that same session.
 await db.query(`WITH expired AS (
  SELECT t.id,t.attempts,t.claim_token FROM v2_publication_targets t JOIN v2_publication_jobs j ON j.id=t.job_id
  WHERE t.platform='youtube' AND t.state='running' AND t.claim_until<clock_timestamp()
   ORDER BY t.claim_until LIMIT 10 FOR UPDATE OF t SKIP LOCKED
 ), changed AS (
  UPDATE v2_publication_targets t SET state=CASE WHEN t.attempts>=30 THEN 'needs_review' ELSE 'retryable' END,
   claim_token=NULL,claim_until=NULL,next_attempt_at=clock_timestamp(),last_error_code='worker_restarted'
  FROM expired e WHERE t.id=e.id AND t.claim_token=e.claim_token RETURNING t.id,t.state,e.attempts,e.claim_token
 ) UPDATE v2_publication_attempts a SET ended_at=clock_timestamp(),outcome=c.state,error_code='worker_restarted'
  FROM changed c WHERE a.target_id=c.id AND a.attempt=c.attempts AND a.claim_token=c.claim_token AND a.ended_at IS NULL`);
}
async function cleanupArtifacts(db:QueryableV2,storage:PublishingStorage):Promise<void>{
 const rows=(await db.query(`SELECT a.object_key,a.user_id FROM v2_publication_artifacts a WHERE a.expires_at<clock_timestamp()
  AND NOT EXISTS (SELECT 1 FROM v2_youtube_checkpoints c JOIN v2_publication_targets t ON t.id=c.target_id
   WHERE c.artifact_key=a.object_key AND t.state IN ('queued','retryable','running')) ORDER BY a.expires_at LIMIT 5`)).rows;
 for(const row of rows){
  const key=String(row.object_key);
  if(!key.startsWith('publishing/users/'+row.user_id+'/')||!/^publishing\/users\/\d+\/[0-9a-f-]+\/\d+\/[a-f0-9]{64}\.mp4$/.test(key))continue;
  await storage.s3.send(new DeleteObjectCommand({Bucket:storage.bucket,Key:key}));
  await db.query('DELETE FROM v2_publication_artifacts WHERE object_key=$1 AND expires_at<clock_timestamp()',[key]);
 }
}
export async function runPublicationOnce(db:QueryableV2,{storage,config,http=fetch,render=renderPublication}:WorkerOptions):Promise<boolean>{
 const target=await claimPublicationTarget(db,'youtube');if(!target)return false;
 const controller=new AbortController();let heartbeatBusy=false,dir='',sessionKnown=false,artifactKey:string|null=null;
 const args=[target.id,target.claimToken];
 const heartbeat=setInterval(()=>{
  if(heartbeatBusy)return;heartbeatBusy=true;
  void db.query(`UPDATE v2_publication_targets SET claim_until=clock_timestamp()+interval '2 minutes'
   WHERE id=$1::bigint AND claim_token=$2::uuid AND state='running' AND claim_until>clock_timestamp() RETURNING id`,args)
   .then(r=>{if(r.rowCount!==1)controller.abort()},()=>controller.abort()).finally(()=>{heartbeatBusy=false});
 },20000);
 try{
  const job=(await db.query('SELECT * FROM v2_publication_jobs WHERE id=$1::uuid',[target.jobId])).rows[0];
  let checkpoint=(await db.query('SELECT * FROM v2_youtube_checkpoints WHERE target_id=$1::bigint',[target.id])).rows[0];
  sessionKnown=!!checkpoint?.session_cipher;
  if(!job||!job.audio_file_id||!job.cover_file_id)throw new PublishingError('source_media_missing',404);
  const owner=Number(job.user_id);
  let auth=await youtubeAccess(db,owner,config,http);
  const generation=auth.generation;
  if(job.youtube_generation!==generation)throw new PublishingError('publication_connection_changed',409);
  const fence=async()=>{
   controller.signal.throwIfAborted();
   const check=await db.query(`SELECT t.id FROM v2_publication_targets t JOIN v2_publication_jobs j ON j.id=t.job_id
    JOIN v2_youtube_connections c ON c.user_id=j.user_id WHERE t.id=$1::bigint AND t.claim_token=$2::uuid
    AND t.state='running' AND t.claim_until>clock_timestamp() AND c.generation=$3::uuid
    AND j.state='ready' AND j.audio_file_id IS NOT NULL AND j.cover_file_id IS NOT NULL`,[...args,generation]);
   if(check.rowCount!==1)throw new PublishingError('publication_connection_changed',409);
  };
  await fence();
  const assets=(await db.query(`SELECT id,kind,object_key,byte_size,sha256 FROM library_files WHERE user_id=$1 AND status='ready'
   AND ((id=$2 AND kind='audio') OR (id=$3 AND kind='cover'))`,[owner,job.audio_file_id,job.cover_file_id])).rows;
  const audio=assets.find(f=>f.kind==='audio'),cover=assets.find(f=>f.kind==='cover');
  if(!audio||!cover)throw new PublishingError('source_media_missing',404);
  dir=await mkdtemp(join(tmpdir(),'onece-publish-'));
  const output=join(dir,'video.mp4');
  let bytes:number,sha:string;
  if(checkpoint){
   if(checkpoint.connection_generation!==generation)throw new PublishingError('publication_connection_changed',409);
   artifactKey=String(checkpoint.artifact_key);bytes=Number(checkpoint.artifact_bytes);sha=String(checkpoint.artifact_sha);
   if(!artifactKey.startsWith(`publishing/users/${owner}/${target.jobId}/${target.id}/`)||!artifactKey.endsWith('/'+sha+'.mp4')||!/^[a-f0-9]{64}$/.test(sha))throw new PublishingError('checkpoint_invalid',409);
   sessionKnown=!!checkpoint.session_cipher;
   await downloadPublishingAsset(storage,artifactKey,output,bytes,sha,controller.signal);
  }else{
   const audioPath=join(dir,/\.wav$/i.test(String(audio.object_key))?'audio.wav':'audio.mp3');
   const coverPath=join(dir,'cover.image');
   await downloadPublishingAsset(storage,String(audio.object_key),audioPath,Number(audio.byte_size),typeof audio.sha256==='string'?audio.sha256:null,controller.signal);
   await downloadPublishingAsset(storage,String(cover.object_key),coverPath,Number(cover.byte_size),typeof cover.sha256==='string'?cover.sha256:null,controller.signal);
   await render({audio:audioPath,cover:coverPath,output,variant:target.variant==='shorts'?'shorts':'standard',signal:controller.signal});
   await fence();bytes=(await stat(output)).size;sha=await hashPublishingFile(output);
   artifactKey=`publishing/users/${owner}/${target.jobId}/${target.id}/${sha}.mp4`;
   await db.query(`INSERT INTO v2_publication_artifacts(object_key,user_id) VALUES($1,$2)
    ON CONFLICT(object_key) DO UPDATE SET expires_at=clock_timestamp()+interval '7 days'`,[artifactKey,owner]);
   const artifactBody=createReadStream(output);
   try{await storage.s3.send(new PutObjectCommand({Bucket:storage.bucket,Key:artifactKey,Body:artifactBody,ContentLength:bytes,ContentType:'video/mp4'}),{abortSignal:controller.signal})}
   finally{artifactBody.destroy();}
   await fence();
   await db.query(`INSERT INTO v2_youtube_checkpoints(target_id,connection_generation,artifact_key,artifact_sha,artifact_bytes)
    SELECT id,$3::uuid,$4,$5,$6 FROM v2_publication_targets WHERE id=$1::bigint AND claim_token=$2::uuid
     AND state='running' AND claim_until>clock_timestamp() ON CONFLICT(target_id) DO NOTHING`,[...args,generation,artifactKey,sha,bytes]);
   checkpoint=(await db.query('SELECT * FROM v2_youtube_checkpoints WHERE target_id=$1::bigint',[target.id])).rows[0];
   if(!checkpoint||checkpoint.artifact_sha!==sha)throw new PublishingError('checkpoint_not_saved',503);
  }
  await db.query("UPDATE v2_publication_artifacts SET expires_at=clock_timestamp()+interval '7 days' WHERE object_key=$1",[artifactKey]);
  if(Date.now()+60000>=auth.expiresAt){
   auth=await youtubeAccess(db,owner,config,http);if(auth.generation!==generation)throw new PublishingError('publication_connection_changed',409);
  }
  await fence();
  let uri:string;
  if(checkpoint.session_cipher){
   uri=openPublishing(String(checkpoint.session_cipher),'youtube-session:'+owner+':'+target.id,config.encryptionSecret);sessionKnown=true;
  }else{
   // No media is ever sent before this capability is durably checkpointed.
   uri=await beginYouTubeUpload({accessToken:auth.accessToken,title:String(job.title),description:[job.description,job.hashtags].filter(Boolean).join('\n\n'),
    totalBytes:bytes,privacy:job.privacy as 'private'|'unlisted'|'public',http});
   await fence();
   const saved=await db.query(`UPDATE v2_youtube_checkpoints c SET session_cipher=$3,updated_at=clock_timestamp()
    FROM v2_publication_targets t WHERE c.target_id=t.id AND t.id=$1::bigint AND t.claim_token=$2::uuid
     AND t.state='running' AND t.claim_until>clock_timestamp() RETURNING c.target_id`,
   [...args,sealPublishing(uri,'youtube-session:'+owner+':'+target.id,config.encryptionSecret)]);
   if(saved.rowCount!==1)throw new PublishingError('checkpoint_not_saved',503);sessionKnown=true;
  }
  let progress=await probeYouTubeUpload({sessionUri:uri,accessToken:auth.accessToken,totalBytes:bytes,http});
  const file=await open(output,'r');let stalled=0;
  try{
   while(progress.state==='pending'){
    await fence();
    if(Date.now()+60000>=auth.expiresAt){
     auth=await youtubeAccess(db,owner,config,http);if(auth.generation!==generation)throw new PublishingError('publication_connection_changed',409);
    }
    const start=progress.nextByte,chunk=Buffer.alloc(Math.min(4*1024*1024,bytes-start));
    const read=await file.read(chunk,0,chunk.length,start);
    if(read.bytesRead!==chunk.length)throw new PublishingError('artifact_incomplete',422);
    progress=await sendYouTubeChunk({sessionUri:uri,accessToken:auth.accessToken,totalBytes:bytes,start,bytes:chunk,http});
    if(progress.state==='pending'){
     if(progress.nextByte<start)throw new PublishingError('youtube_progress_invalid',503);
     if(progress.nextByte===start){if(++stalled>=3)throw new PublishingError('youtube_progress_stalled',503)}else stalled=0;
     const delay=progress.retryAfterSeconds;
     if(delay)await new Promise(resolve=>setTimeout(resolve,Math.min(60,delay)*1000));
    }
   }
  }finally{await file.close();}
  if(progress.state==='needs_review'&&(progress.httpStatus>=500||[401,429].includes(progress.httpStatus)))throw new PublishingError('youtube_temporarily_unavailable',503);
  if(progress.state!=='complete')throw new PublishingError('youtube_upload_needs_review',409);
  const recorded=await db.query(`UPDATE v2_publication_targets SET remote_id=$3 WHERE id=$1::bigint
   AND claim_token=$2::uuid AND state='running' AND claim_until>clock_timestamp() RETURNING id`,[...args,progress.videoId]);
  if(recorded.rowCount!==1)throw new PublishingError('publication_cancelled',409);
  const confirmation=await http('https://www.googleapis.com/youtube/v3/videos?part=status&id='+encodeURIComponent(progress.videoId),{
   redirect:'error',headers:{Authorization:'Bearer '+auth.accessToken},signal:AbortSignal.timeout(15000)});
  const confirmed:unknown=await confirmation.json().catch(()=>null);
  const items=confirmed&&typeof confirmed==='object'?(confirmed as Record<string,unknown>).items:null;
  const video=Array.isArray(items)&&items[0]&&typeof items[0]==='object'?items[0] as Record<string,unknown>:null;
  const status=video?.status&&typeof video.status==='object'?video.status as Record<string,unknown>:null;
  if(!confirmation.ok||video?.id!==progress.videoId||!status)throw new PublishingError('youtube_confirmation_pending',503);
  if(status.privacyStatus!==job.privacy||['rejected','failed','deleted'].includes(String(status.uploadStatus))){
   await settlePublicationTarget(db,target.id,target.claimToken,'needs_review',{remoteId:progress.videoId,errorCode:'youtube_visibility_restricted'});
   return true;
  }
  const settled=await settlePublicationTarget(db,target.id,target.claimToken,'succeeded',{remoteId:progress.videoId});
  if(settled&&artifactKey){
   await storage.s3.send(new DeleteObjectCommand({Bucket:storage.bucket,Key:artifactKey}));
   await db.query('DELETE FROM v2_publication_artifacts WHERE object_key=$1',[artifactKey]);
  }
 }catch(error){
  const code=error instanceof PublishingError?error.code:'publication_temporarily_unavailable';
  // A saved session can be probed safely on retry; never replace an ambiguous session.
  const permanent=error instanceof PublishingError&&[400,404,422].includes(error.status);
  const review=code==='youtube_upload_needs_review'||code==='publication_connection_changed'||code==='checkpoint_invalid'||(permanent&&sessionKnown);
  await settlePublicationTarget(db,target.id,target.claimToken,review?'needs_review':permanent&&!sessionKnown?'failed':'retryable',{errorCode:code});
 }finally{
  clearInterval(heartbeat);controller.abort();
  if(dir&&dirname(resolve(dir))===resolve(tmpdir())&&basename(dir).startsWith('onece-publish-'))await rm(dir,{recursive:true,force:true});
  await db.query(`UPDATE v2_publication_jobs j SET state=CASE
   WHEN NOT EXISTS (SELECT 1 FROM v2_publication_targets t WHERE t.job_id=j.id AND t.state<>'succeeded') THEN 'succeeded'
   ELSE 'failed' END,updated_at=clock_timestamp() WHERE j.id=$1::uuid
   AND NOT EXISTS (SELECT 1 FROM v2_publication_targets t WHERE t.job_id=j.id AND t.state IN ('queued','retryable','running','draft'))`,[target.jobId]);
 }
 return true;
}
export function startPublicationWorker(db:QueryableV2):()=>void{
 const config=publishingConfig(),storage=publishingStorage();
 if(!config||!storage||!publicationRendererAvailable())return()=>{};
 let stopped=false,timer:ReturnType<typeof setTimeout>|null=null;
 const tick=async()=>{
  try{await ensurePublishingSchema(db);await recoverYouTubeClaims(db);
   try{await cleanupArtifacts(db,storage)}catch{console.error('publication artifact cleanup temporarily unavailable');}
   await runPublicationOnce(db,{config,storage});
  }catch{console.error('publication worker temporarily unavailable');}
  if(!stopped){timer=setTimeout(()=>{void tick()},5000);timer.unref();}
 };
 void tick();return()=>{stopped=true;if(timer)clearTimeout(timer);storage.s3.destroy();};
}
