// Called only by the existing disposable-CI PostgreSQL runner. Meta and R2 are
// in-process fixtures; real SQL verifies leases, receipts and recovery fencing.
import assert from 'node:assert/strict';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {Readable} from 'node:stream';
import {writeFile} from 'node:fs/promises';
import {enqueuePublication,listPublications,retryPublication} from '../dist/publishing-jobs.js';
import {runInstagramReelOnce,quarantineExpiredInstagramClaims} from '../dist/instagram-reels-worker.js';
import {handleInstagramMetaCompliance} from '../dist/instagram-meta-compliance.js';
import {processInstagramDataDeletionOnce,serveInstagramDataDeletionStatus} from '../dist/instagram-data-deletion.js';
import {beginInstagramConnection} from '../dist/instagram-connection.js';
import {ensurePublishingSchema} from '../dist/publishing-schema.js';
import {sealPublishing} from '../dist/publishing-secrets.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
export async function instagramReliabilitySmoke(db){
 const url=new URL(process.env.S2_TEST_DATABASE_URL||'https://invalid');
 assert.equal(process.env.CI,'true');assert.equal(process.env.GITHUB_ACTIONS,'true');
 assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
 assert.equal(url.port,'5432');assert.equal(url.pathname,'/onece_s2_ci');
 const previous=process.env.INSTAGRAM_REELS_ENABLED;process.env.INSTAGRAM_REELS_ENABLED='true';
 const config={appId:'synthetic',appSecret:'synthetic-meta-compliance-secret',encryptionSecret:'synthetic-publishing-key',
  redirectUri:'https://api.invalid/auth/instagram/callback',webOrigin:'https://web.invalid'};
 const objects=new Map(),receipts=[];
 let owner,other;
 try{
  owner=Number((await db.query('INSERT INTO account_users(email) VALUES($1) RETURNING id',
   ['instagram-reliability-'+randomUUID()+'@ci.invalid'])).rows[0].id);
  const instagramId='178414053092'+owner;
  const connect=async()=>db.query(`INSERT INTO v2_instagram_connections
   (user_id,instagram_user_id,username,access_cipher,expires_at,generation)
   VALUES($1,$2,'fixture',$3,clock_timestamp()+interval '30 days',$4::uuid)
   ON CONFLICT(user_id) DO UPDATE SET generation=EXCLUDED.generation,access_cipher=EXCLUDED.access_cipher`,
   [owner,instagramId,sealPublishing('synthetic-access','instagram-access:'+owner,config.encryptionSecret),randomUUID()]);
  await connect();
  const files=[];
  for(const kind of ['audio','cover']){
   const bytes=Buffer.from('synthetic-'+kind),key='users/'+owner+'/assets/'+kind+'/'+randomUUID();
   objects.set(key,bytes);
   files.push(Number((await db.query(`INSERT INTO library_files(user_id,kind,object_key,original_name,content_type,byte_size,status,sha256)
    VALUES($1,$2,$3,'fixture',$4,$5,'ready',$6) RETURNING id`,
    [owner,kind,key,kind==='audio'?'audio/mpeg':'image/png',bytes.length,hash(bytes)])).rows[0].id));
  }
  const storage={bucket:'synthetic',s3:{async send(command){
   const input=command.input;
   if(command.constructor.name==='GetObjectCommand'){
    assert.ok(objects.has(input.Key));return{Body:Readable.from([objects.get(input.Key)])};
   }
   if(command.constructor.name==='PutObjectCommand'){
    const chunks=[];for await(const chunk of input.Body)chunks.push(chunk);
    objects.set(input.Key,Buffer.concat(chunks));return{};
   }
   if(command.constructor.name==='DeleteObjectCommand'){objects.delete(input.Key);return{};}
   throw Error('Unexpected synthetic storage call');
  }}};
  for(const mode of ['success','lost-response','checkpoint-failure','expired-lease','quarantined','crash','reconnect']){
   await connect();
   const input={requestId:randomUUID(),title:'Fixture '+mode,description:'',hashtags:'',privacy:'private',
    audioFileId:files[0],coverFileId:files[1],targets:[{platform:'instagram',variant:'default'}],instagramPublicConsent:true};
   const job=await enqueuePublication(db,owner,input);
   assert.equal((await enqueuePublication(db,owner,input)).id,job.id);
   let publishes=0,requests=0,down=false,checkpointFailed=false;
   const executorDb={async query(sql,args){
    if(down)throw Error('Synthetic process/database interruption');
    if(mode==='checkpoint-failure'&&!checkpointFailed&&sql.startsWith('UPDATE v2_instagram_checkpoints SET published_media_id')){
     checkpointFailed=true;throw Error('Synthetic checkpoint write failure');
    }
    return db.query(sql,args);
   }};
   const http=async(raw,init={})=>{
    requests++;const url=new URL(raw);
    assert.equal(url.hostname,'graph.instagram.com');
    assert.equal(url.searchParams.has('access_token'),false);
    assert.equal(init.headers.Authorization,'Bearer synthetic-access');
    if(url.pathname==='/me')return Response.json({id:instagramId,username:'fixture'});
    if(url.pathname.endsWith('/media'))return Response.json({id:'222'});
    if(url.pathname.endsWith('/222'))return Response.json({status_code:'FINISHED'});
    assert.ok(url.pathname.endsWith('/media_publish'));publishes++;
    if(mode==='lost-response')throw Error('Synthetic provider response lost');
    if(mode==='expired-lease')await db.query(`UPDATE v2_publication_targets
     SET claim_until=clock_timestamp()-interval '1 second' WHERE job_id=$1`,[job.id]);
    if(mode==='quarantined')await db.query(`UPDATE v2_publication_targets
     SET state='needs_review',claim_token=NULL,claim_until=NULL WHERE job_id=$1`,[job.id]);
    if(mode==='crash')down=true;
    return Response.json({id:'333'});
   };
   const options={config,storage,http,render:async({output})=>writeFile(output,Buffer.from('synthetic-render'))};
   if(mode==='reconnect')await connect();
   if(mode==='crash'){
    await assert.rejects(runInstagramReelOnce(executorDb,options),/Synthetic/);
    down=false;
    await db.query(`UPDATE v2_publication_targets SET claim_until=clock_timestamp()-interval '1 second'
     WHERE job_id=$1 AND state='running'`,[job.id]);
    await quarantineExpiredInstagramClaims(db);
   }else await runInstagramReelOnce(executorDb,options);
   const history=(await listPublications(db,owner)).find(item=>item.id===job.id);
   assert.equal(history.requestId,input.requestId);
   const target=history.targets[0];
   assert.equal(target.state,mode==='success'?'succeeded':mode==='reconnect'?'failed':'needs_review',mode);
   if(['success','checkpoint-failure','expired-lease','quarantined'].includes(mode))
    assert.equal(target.remoteId,'333',mode+' must preserve provider confirmation');
   assert.equal(publishes,mode==='reconnect'?0:1,mode);
   if(mode==='reconnect')assert.equal(requests,0);
   assert.equal(await retryPublication(db,owner,target.id),false,'No blind retry: '+mode);
   assert.equal(await runInstagramReelOnce(executorDb,options),false,'No second claim: '+mode);
   assert.equal(publishes,mode==='reconnect'?0:1);
   assert.equal((await enqueuePublication(db,owner,input)).id,job.id,'Terminal history retains request idempotency');
  }
  await connect();
  const payload=Buffer.from(JSON.stringify({algorithm:'HMAC-SHA256',user_id:instagramId})).toString('base64url');
  const signed=createHmac('sha256',config.appSecret).update(payload).digest('base64url')+'.'+payload;
  const callback=async action=>{
   const req=Readable.from([new URLSearchParams({signed_request:signed}).toString()]);
   req.method='POST';req.headers={'content-type':'application/x-www-form-urlencoded'};
   const res={status:0,body:'',writeHead(status){this.status=status},end(body){this.body=body},setHeader(){}};
   await handleInstagramMetaCompliance(req,res,new URL('https://api.invalid/api/instagram/meta-compliance?action='+action),db,config);
   return res;
  };
  for(const action of ['deauthorize','data-deletion'])receipts.push(hash(action+':'+signed));
  const duplicates=await Promise.all([callback('deauthorize'),callback('deauthorize')]);
  assert.ok(duplicates.every(item=>item.status===200));
  await connect();
  assert.equal((await callback('deauthorize')).status,200);
  assert.equal((await db.query('SELECT 1 FROM v2_instagram_connections WHERE user_id=$1',[owner])).rowCount,1,
   'Replayed deauth cannot remove a newly connected generation');
  const youtubeGeneration=randomUUID();
  await db.query(`INSERT INTO v2_youtube_connections(user_id,refresh_cipher,channel_id,channel_title,generation)
   VALUES($1,'synthetic-cipher','synthetic-channel','Fixture',$2)`,[owner,youtubeGeneration]);
  const mixed=await enqueuePublication(db,owner,{requestId:randomUUID(),title:'Mixed fixture',description:'Keep for YouTube',
   hashtags:'',privacy:'private',audioFileId:files[0],coverFileId:files[1],instagramPublicConsent:true,
   targets:[{platform:'youtube',variant:'standard'},{platform:'instagram',variant:'default'}]});
  const mixedTargets=(await db.query('SELECT id,platform FROM v2_publication_targets WHERE job_id=$1',[mixed.id])).rows;
  const youtubeTarget=mixedTargets.find(t=>t.platform==='youtube').id;
  const youtubeKey=`publishing/users/${owner}/${mixed.id}/${youtubeTarget}/${hash('youtube-artifact')}.mp4`;
  objects.set(youtubeKey,Buffer.from('youtube-artifact'));
  await db.query('INSERT INTO v2_publication_artifacts(object_key,user_id) VALUES($1,$2)',[youtubeKey,owner]);
  await db.query(`INSERT INTO v2_youtube_checkpoints(target_id,connection_generation,artifact_key,artifact_sha,artifact_bytes)
   VALUES($1,$2,$3,$4,16)`,[youtubeTarget,youtubeGeneration,youtubeKey,hash('youtube-artifact')]);
  other=Number((await db.query('INSERT INTO account_users(email) VALUES($1) RETURNING id',
   ['instagram-other-'+randomUUID()+'@ci.invalid'])).rows[0].id);
  const foreignJob=(await db.query(`INSERT INTO v2_publication_jobs(user_id,request_id,request_hash,title)
   VALUES($1,$2,$3,'Foreign fixture') RETURNING id`,[other,randomUUID(),hash('foreign')])).rows[0].id;
  await db.query(`INSERT INTO v2_publication_targets(job_id,platform,state) VALUES($1,'instagram','succeeded')`,[foreignJob]);
  // Pause another process's startup after its identity scan. Cleanup must not
  // be undone when that process resumes with the now-stale connection rows.
  let scanned,releaseScan;
  const scanReady=new Promise(resolve=>{scanned=resolve});
  const scanRelease=new Promise(resolve=>{releaseScan=resolve});
  const staleBackfill=ensurePublishingSchema({async query(sql,args){
   const result=await db.query(sql,args);
   if(sql==='SELECT user_id,instagram_user_id FROM v2_instagram_connections'){
    scanned();await scanRelease;
   }
   return result;
  }});
  await Promise.race([scanReady,staleBackfill.then(()=>{throw Error('Expected identity scan')})]);
  const deletions=await Promise.all([callback('data-deletion'),callback('data-deletion')]);
  assert.ok(deletions.every(item=>item.status===200));assert.equal(deletions[0].body,deletions[1].body);
  const acknowledgement=JSON.parse(deletions[0].body),statusUrl=new URL(acknowledgement.url);
  assert.equal(statusUrl.pathname,'/api/instagram/data-deletion-status');
  const deletionStatus=async()=>{
   const response={status:0,body:'',writeHead(status){this.status=status},end(body){this.body=body}};
   await serveInstagramDataDeletionStatus({method:'GET'},response,statusUrl,db);
   return JSON.parse(response.body).status;
  };
  assert.equal(await deletionStatus(),'pending');
  assert.equal(await processInstagramDataDeletionOnce(db,storage),false,'Default quiet period must be respected');
  await assert.rejects(beginInstagramConnection(db,owner,config),{code:'instagram_data_deletion_pending'});
  await assert.rejects(enqueuePublication(db,owner,{requestId:randomUUID(),title:'Blocked',description:'',hashtags:'',privacy:'private',
   audioFileId:files[0],coverFileId:files[1],targets:[{platform:'instagram',variant:'default'}],instagramPublicConsent:true}),
  {code:'instagram_data_deletion_pending'});
  // Only disposable CI advances the delay; there are no in-flight writers here.
  await db.query(`UPDATE v2_instagram_data_deletions SET not_before=clock_timestamp()-interval '1 second'`);
  let failedDelete=false;
  const unreliable={...storage,s3:{async send(command){if(command.constructor.name==='DeleteObjectCommand'&&!failedDelete){
   failedDelete=true;throw Error('Synthetic R2 outage');}return storage.s3.send(command)}}};
  await assert.rejects(processInstagramDataDeletionOnce(db,unreliable),/Synthetic R2 outage/);
  assert.equal(await deletionStatus(),'pending','No false completion when R2 fails');
  assert.equal(await processInstagramDataDeletionOnce(db,storage),false,'Failure backoff must be respected');
  await db.query(`UPDATE v2_instagram_data_deletions SET not_before=clock_timestamp()-interval '1 second'`);
  for(let pass=0;pass<10&&await deletionStatus()==='pending';pass++)await processInstagramDataDeletionOnce(db,storage);
  assert.equal(await deletionStatus(),'completed');
  releaseScan();await staleBackfill;
  const deleted=(await db.query(`SELECT owners,completed_at FROM v2_instagram_data_deletions`)).rows[0];
  assert.deepEqual(deleted.owners,[]);assert.ok(deleted.completed_at,'Completion drops owner links');
  assert.equal((await db.query('SELECT 1 FROM v2_instagram_connections WHERE user_id=$1',[owner])).rowCount,0);
  assert.equal((await db.query('SELECT 1 FROM v2_instagram_compliance_subjects WHERE user_id=$1',[owner])).rowCount,0);
  assert.equal((await db.query(`SELECT 1 FROM v2_publication_targets t JOIN v2_publication_jobs j ON j.id=t.job_id
   WHERE j.user_id=$1 AND t.platform='instagram'`,[owner])).rowCount,0);
  assert.equal((await db.query('SELECT 1 FROM library_files WHERE user_id=$1',[owner])).rowCount,2);
  assert.equal((await db.query('SELECT 1 FROM account_users WHERE id=$1',[owner])).rowCount,1);
  assert.equal((await db.query('SELECT 1 FROM v2_youtube_connections WHERE user_id=$1',[owner])).rowCount,1);
  assert.equal((await db.query('SELECT 1 FROM v2_youtube_checkpoints WHERE target_id=$1',[youtubeTarget])).rowCount,1);
  assert.equal((await db.query('SELECT 1 FROM v2_publication_targets WHERE job_id=$1',[foreignJob])).rowCount,1);
  assert.equal((await db.query('SELECT description,instagram_generation FROM v2_publication_jobs WHERE id=$1',[mixed.id])).rows[0].description,'Keep for YouTube');
  assert.ok(objects.has(youtubeKey));
  assert.equal([...objects.keys()].filter(key=>key.startsWith('publishing/users/'+owner+'/')&&key!==youtubeKey).length,0);
  await connect();
  assert.equal((await callback('data-deletion')).status,200);
  assert.equal((await db.query('SELECT 1 FROM v2_instagram_connections WHERE user_id=$1',[owner])).rowCount,1,
   'A completed deletion replay must not revoke a later connection');
  console.log('Instagram reliability PASS: PostgreSQL leases, crash recovery, late confirmation, reconnect, request dedup, concurrent Meta receipts, durable deletion/R2 retry and mixed-platform/owner isolation; external providers simulated.');
 }finally{
  for(const receipt of receipts)await db.query('DELETE FROM v2_instagram_data_deletions WHERE request_hash=$1',[receipt]);
  for(const receipt of receipts)await db.query('DELETE FROM v2_instagram_compliance_receipts WHERE request_hash=$1',[receipt]);
  if(owner){
   await db.query('DELETE FROM v2_publication_artifacts WHERE user_id=$1',[owner]);
   await db.query('DELETE FROM account_users WHERE id=$1',[owner]);
  }
  if(other)await db.query('DELETE FROM account_users WHERE id=$1',[other]);
  if(previous===undefined)delete process.env.INSTAGRAM_REELS_ENABLED;else process.env.INSTAGRAM_REELS_ENABLED=previous;
 }
}
