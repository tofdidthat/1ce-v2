// Run against the disposable publishing integration database. All provider I/O is injected.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {writeFile} from 'node:fs/promises';
import {enqueuePublication,retryPublication,listPublications} from '../dist/publishing-jobs.js';
import {beginTikTokConnection,startTikTokConnection,finishTikTokConnection,disconnectTikTok,tikTokAccess,tiktokConnectionStatus} from '../dist/tiktok-connection.js';
import {runTikTokOnce,recoverTikTokClaims} from '../dist/tiktok-worker.js';
import {claimPublicationTarget} from '../dist/publication-queue.js';
import {handlePublishing} from '../dist/publishing-api.js';
import {serveTikTokMedia} from '../dist/instagram-reel-media.js';

export async function tikTokPublishingSmoke(db) {
 const connection=db.options.connectionString?new URL(db.options.connectionString):null;
 assert.ok(['127.0.0.1','localhost'].includes(connection?.hostname||db.options.host));
 const name=(await db.query('SELECT current_database() AS name')).rows[0].name;
 assert.ok(['onece_s2_ci','t053'].includes(name),'Disposable fixture database required');
 const config={clientKey:'fixture',clientSecret:'fixture-secret',encryptionSecret:'fixture-integration-secret',
  redirectUri:'https://api.invalid/auth/tiktok/callback',webOrigin:'https://web.invalid'};
 const flags={TIKTOK_DRAFT_UPLOAD_ENABLED:'true',TIKTOK_VERIFIED_URL_PREFIX:'https://api.invalid/api/publishing/',
  TIKTOK_REDIRECT_URI:config.redirectUri,INSTAGRAM_REELS_ENABLED:'true'};
 const prev=Object.fromEntries(Object.keys(flags).map(k=>[k,process.env[k]]));Object.assign(process.env,flags);
 const addOwner=async()=> (await db.query('INSERT INTO account_users(email) VALUES($1) RETURNING id',[randomUUID()+'@qa.invalid'])).rows[0].id;
 const owner=await addOwner(),other=await addOwner();
 const objects=new Map();
 let lost=false,rateLimited=false,storageFails=false,unlinkOnUpload=false,status='PROCESSING_DOWNLOAD',initializations=0,refreshes=0,exchanges=0,lastUrl;
 const tokens={access_token:'fixture-access',refresh_token:'fixture-refresh',open_id:'fixture-owner',
  scope:'user.info.basic,video.upload',expires_in:7200,refresh_expires_in:36000};
 const ok=data=>Response.json({error:{code:'ok'},data});
 const http=async(raw,options)=>{
  const url=new URL(raw);assert.equal(url.hostname,'open.tiktokapis.com');
  switch(url.pathname){
   case '/v2/oauth/token/':
    if(options.body.get('grant_type')==='refresh_token'){refreshes++;return Response.json({...tokens,refresh_token:'fixture-rotated'});}
    exchanges++;return Response.json(tokens);
   case '/v2/user/info/':return ok({user:{open_id:tokens.open_id,display_name:'QA creator'}});
   case '/v2/oauth/revoke/':return Response.json({});
   case '/v2/post/publish/inbox/video/init/':{
    const body=JSON.parse(options.body);initializations++;lastUrl=new URL(body.source_info.video_url);
    assert.deepEqual(body,{source_info:{source:'PULL_FROM_URL',video_url:lastUrl.href}});
    assert.equal(lastUrl.origin,'https://api.invalid');assert.equal(lastUrl.pathname,'/api/publishing/tiktok-media');
    const receipt=await db.query('SELECT * FROM v2_tiktok_checkpoints WHERE publish_id IS NULL AND token_hash=encode(sha256(convert_to($1,\'UTF8\')),\'hex\')',[lastUrl.searchParams.get('token')]);
    assert.equal(receipt.rowCount,1,'durable marker before init');
    if(rateLimited)return Response.json({error:{code:'rate_limit_exceeded'}},{status:429});
    if(lost){
     await db.query("UPDATE v2_publication_targets SET claim_until=now()-interval '1 second' WHERE id=$1",[receipt.rows[0].target_id]);
     throw Error('synthetic lost response and expired lease');
    }
    return ok({publish_id:'v_inbox_url~v2.'+initializations});
   }
   case '/v2/post/publish/status/fetch/':return ok({status});
   default:throw Error('Unexpected mock call');
  }
 };
 const storage={bucket:'fixtures',s3:{async send(cmd){
  const i=cmd.input;
  if(cmd.constructor.name==='GetObjectCommand')return {Body:Readable.from([objects.get(i.Key)])};
  assert.equal(cmd.constructor.name,'PutObjectCommand');if(storageFails)throw Error('synthetic storage failure');
  const chunks=[];for await(const chunk of i.Body)chunks.push(chunk);objects.set(i.Key,Buffer.concat(chunks));
  if(unlinkOnUpload)await disconnectTikTok(db,owner,config,http);
  return {};
 }}};
 const worker=()=>runTikTokOnce(db,{config,storage,http,render:({output})=>writeFile(output,'fixture-render'),
  validateDuration:async(_,limit)=>assert.equal(limit,600)});
 const response=()=>({headers:{},writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}});
 try {
  const begin=async()=>new URL((await beginTikTokConnection(db,owner,config)).url).searchParams.get('state');
  const expired=await begin();
  await db.query("UPDATE v2_tiktok_oauth SET expires_at=now()-interval '1 minute' WHERE user_id=$1",[owner]);
  await assert.rejects(startTikTokConnection(db,owner,expired,config),/state_expired/);
  const state=await begin();
  await assert.rejects(startTikTokConnection(db,other,state,config),/state_expired/);
  const consent=await startTikTokConnection(db,owner,state,config);
  const callback=async user=>{
   const res=response();
   await finishTikTokConnection({headers:{cookie:consent.cookie}},res,new URL(config.redirectUri+'?code=fixture&state='+state),db,config,user,http);
   return res.headers.Location;
  };
  assert.match(await callback(other),/state_expired/);assert.equal(exchanges,0);
  assert.match(await callback(owner),/tiktok-connected/);
  assert.match(await callback(owner),/state_expired/);assert.equal(exchanges,1);
  const connectionStatus=await tiktokConnectionStatus(db,owner,config);
  assert.equal(connectionStatus.nickname,'QA creator');
  assert.ok(connectionStatus.connectionId);
  assert.doesNotMatch(JSON.stringify(connectionStatus),/fixture-access|fixture-refresh|fixture-owner/);
  const apiStatus=async path=>{
   const res=response();
   await handlePublishing({method:'GET',url:path,headers:{}},res,path,db,async()=>({id:owner}),
    {config:null,instagram:null,tiktok:config,renderer:()=>false,http});
   return {code:res.status,data:JSON.parse(res.body)};
  };
  const statusResponse=await apiStatus('/api/publishing/status');
  assert.equal(statusResponse.code,200);
  assert.deepEqual(statusResponse.data.tiktok,connectionStatus);
  assert.equal((await apiStatus('/api/publishing/tiktok/creator-info')).code,404);
  await db.query("UPDATE v2_tiktok_connections SET access_expires_at=now() WHERE user_id=$1",[owner]);
  const [auth]=await Promise.all([tikTokAccess(db,owner,config,http),tikTokAccess(db,owner,config,http)]);
  assert.equal(refreshes,1);
  const file=async kind=>{
   const key='qa/'+randomUUID();objects.set(key,Buffer.from('x'));
   return Number((await db.query(`INSERT INTO library_files(user_id,kind,object_key,original_name,content_type,byte_size,status)
    VALUES($1,$2,$3,'fixture','application/octet-stream',1,'ready') RETURNING id`,[owner,kind,key])).rows[0].id);
  };
  const input={requestId:randomUUID(),title:'fixture',audioFileId:await file('audio'),coverFileId:await file('cover'),privacy:'private',
   targets:[{platform:'tiktok',variant:'default'}],tiktok:{connectionId:auth.generation,consent:true}};
  const enqueue=(who,value)=>enqueuePublication(db,who,value,config);
  const submit=async()=> (await enqueue(owner,{...input,requestId:randomUUID()})).id;
  const result=async id=>(await listPublications(db,owner)).find(j=>j.id===id).targets.find(t=>t.platform==='tiktok');
  const due=async id=>db.query("UPDATE v2_publication_targets SET next_attempt_at=now() WHERE job_id=$1 AND platform='tiktok'",[id]);
  const expire=async()=>db.query("UPDATE v2_publication_targets SET claim_until=now()-interval '1 second' WHERE platform='tiktok' AND state='running' AND job_id IN (SELECT id FROM v2_publication_jobs WHERE user_id=$1)",[owner]);
  const head=async()=>{const res=response();await serveTikTokMedia({method:'HEAD',headers:{}},res,lastUrl,db,{storage});return res.status;};
  await assert.rejects(enqueue(other,input),/reconnect_required/);
  await db.query("UPDATE v2_tiktok_connections SET scope='user.info.basic,video.publish' WHERE user_id=$1",[owner]);
  assert.equal((await apiStatus('/api/publishing/status')).data.tiktok.connected,false);
  await assert.rejects(enqueue(owner,input),/tiktok_reconnect_required/);
  await db.query("UPDATE v2_tiktok_connections SET scope='user.info.basic, video.upload' WHERE user_id=$1",[owner]);
  process.env.TIKTOK_DRAFT_UPLOAD_ENABLED='false';
  await assert.rejects(enqueue(owner,input),/tiktok_draft_upload_disabled/);
  assert.equal(await worker(),false);
  process.env.TIKTOK_DRAFT_UPLOAD_ENABLED='true';
  const job=await enqueue(owner,input);
  assert.equal((await enqueue(owner,input)).id,job.id);
  await assert.rejects(enqueue(owner,{...input,tiktok:{...input.tiktok,connectionId:randomUUID()}}),/request_id_conflict/);
  await assert.rejects(enqueue(owner,{...input,requestId:randomUUID(),tiktok:{...input.tiktok,connectionId:randomUUID()}}),/tiktok_connection_changed/);
  await assert.rejects(enqueue(owner,{...input,tiktok:{...input.tiktok,privacyLevel:'SELF_ONLY'}}),/tiktok_consent_required/);
  storageFails=true;await worker();assert.equal(initializations,0);
  storageFails=false;rateLimited=true;await due(job.id);await worker();
  assert.equal((await result(job.id)).errorCode,'tiktok_rate_limited');assert.equal(await head(),404);
  rateLimited=false;await due(job.id);await worker();assert.equal(initializations,2);
  assert.equal((await result(job.id)).state,'retryable');assert.equal(await head(),200);
  await due(job.id);await claimPublicationTarget(db,'tiktok');await expire();await recoverTikTokClaims(db);
  await due(job.id);status='SEND_TO_USER_INBOX';await worker();
  assert.equal((await result(job.id)).state,'succeeded');assert.equal(initializations,2);assert.equal(await head(),404);
  const completed=await submit();status='PUBLISH_COMPLETE';await worker();
  assert.equal((await result(completed)).state,'succeeded');assert.equal(initializations,3);
  const legacy=await submit();
  await db.query("UPDATE v2_publication_jobs SET tiktok_preferences=tiktok_preferences || $2::jsonb WHERE id=$1",
   [legacy,JSON.stringify({privacyLevel:'SELF_ONLY'})]);
  await worker();assert.equal((await result(legacy)).state,'failed');assert.equal(initializations,3);
  assert.equal(await retryPublication(db,owner,(await result(legacy)).id),false);
  const ambiguous=await submit();lost=true;await worker();
  await recoverTikTokClaims(db);
  assert.equal((await result(ambiguous)).state,'needs_review');
  assert.equal(await retryPublication(db,owner,(await result(ambiguous)).id),false);
  assert.equal(initializations,4);lost=false;
  await db.query("INSERT INTO v2_youtube_connections VALUES ($1,'fixture','channel','title',$2,now())",[owner,randomUUID()]);
  await db.query("INSERT INTO v2_instagram_connections(user_id,instagram_user_id,username,access_cipher,expires_at,generation) VALUES ($1,'123','qa','fixture',now()+interval '1 day',$2)",[owner,randomUUID()]);
  const mixed=await enqueue(owner,{...input,requestId:randomUUID(),instagramPublicConsent:true,
   targets:[...input.targets,{platform:'instagram',variant:'default'},{platform:'youtube',variant:'shorts'},{platform:'youtube',variant:'standard'}]});
  unlinkOnUpload=true;await worker();
  assert.equal(initializations,4);
  const targets=(await listPublications(db,owner)).find(j=>j.id===mixed.id).targets;
  assert.equal(targets.filter(t=>t.platform!=='tiktok'&&t.state==='queued').length,3);
  assert.notEqual((await result(mixed.id)).state,'succeeded');assert.equal(await head(),404);
 } finally {
  await db.query('DELETE FROM v2_publication_artifacts WHERE user_id=$1',[owner]);
  await db.query('DELETE FROM account_users WHERE id IN ($1,$2)',[owner,other]);
  for(const [k,v] of Object.entries(prev))if(v===undefined)delete process.env[k];else process.env[k]=v;
 }
}
