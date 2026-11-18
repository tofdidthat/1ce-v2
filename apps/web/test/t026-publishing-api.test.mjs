import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadPublishingFile} from '../src/upload-file-v2.ts';
import {publishingRequest,publishingAuthorizationUrl,publishingErrorMessage,canRetryPublishingTarget} from '../src/publishing-api-v2.ts';
const api='https://api.invalid';
test('deduplicated file only hashes and initializes; no beat or pack creation',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({id:11,reused:true})};
 try{
  assert.equal(await uploadPublishingFile(api,new File(['audio'],'beat.mp3'),'audio',new AbortController().signal),11);
  assert.equal(calls.length,1);assert.equal(calls[0].url,api+'/api/library/files/init');
  const body=JSON.parse(calls[0].options.body);assert.match(body.sha256,/^[0-9a-f]{64}$/);assert.equal(body.kind,'audio');
 }finally{globalThis.fetch=original;}
});
test('new cover uses signed PUT without cookies then completes authorized file',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return calls.length===1?Response.json({id:12,uploadUrl:'https://fixture-account.r2.cloudflarestorage.com/signed'}):Response.json({id:12})};
 try{
  assert.equal(await uploadPublishingFile(api,new File(['image'],'cover.png'),'cover',new AbortController().signal),12);
  assert.equal(calls.length,3);assert.equal(calls[1].options.method,'PUT');assert.equal(calls[1].options.credentials,undefined);
  assert.equal(calls[2].url,api+'/api/library/files/12/complete');assert.equal(calls[2].options.credentials,'include');
 }finally{globalThis.fetch=original;}
});
test('invalid files and aborted hashing cannot initialize uploads',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Unexpected network')};
 try{
  await assert.rejects(uploadPublishingFile(api,new File(['x'],'video.mp4'),'audio',new AbortController().signal));
  const controller=new AbortController();controller.abort();
  await assert.rejects(uploadPublishingFile(api,new File(['x'],'audio.wav'),'audio',controller.signal));
  assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});
test('transport retries serialize the identical request and propagate failures',async()=>{
 const original=globalThis.fetch,bodies=[];const payload={requestId:'fixture-uuid',title:'fixture'};
 globalThis.fetch=async(_url,options)=>{bodies.push(options.body);if(bodies.length===1)throw Error('lost response');return Response.json({id:'job',state:'queued'})};
 try{
  await assert.rejects(publishingRequest(api,'/jobs',new AbortController().signal,payload));
  const result=await publishingRequest(api,'/jobs',new AbortController().signal,payload);
  assert.equal(result.state,'queued');assert.equal(bodies[0],bodies[1]);
 }finally{globalThis.fetch=original;}
});
test('ambiguous or succeeded targets never expose retry',()=>{
 for(const state of ['needs_review','succeeded','uploading','queued'])assert.equal(canRetryPublishingTarget({state}),false);
 assert.equal(canRetryPublishingTarget({state:'failed',remoteId:'already-sent'}),false);
 for(const state of ['failed','retryable'])assert.equal(canRetryPublishingTarget({state}),true);
});
test('authorization navigation accepts only the configured API top-level start',()=>{
 const state='pub_'+'a'.repeat(43),url=api+'/auth/youtube/start?state='+state;
 assert.equal(publishingAuthorizationUrl(api,url),url);
 const igUrl=api+'/auth/instagram/start?state=igpub_'+'b'.repeat(43);
 assert.equal(publishingAuthorizationUrl(api,igUrl),igUrl);
 const tiktokUrl=api+'/auth/tiktok/start?state=ttpub_'+'c'.repeat(43);
 assert.equal(publishingAuthorizationUrl(api,tiktokUrl),tiktokUrl);
 assert.throws(()=>publishingAuthorizationUrl(api,'https://evil.invalid/auth/tiktok/start?state=ttpub_'+'c'.repeat(43)));
 assert.throws(()=>publishingAuthorizationUrl(api,tiktokUrl+'&next=evil'));
 assert.throws(()=>publishingAuthorizationUrl(api,tiktokUrl+'&state=duplicate'));
 assert.throws(()=>publishingAuthorizationUrl(api,'https://evil.invalid/auth/instagram/start?state=igpub_'+'b'.repeat(43)));
 assert.throws(()=>publishingAuthorizationUrl(api,igUrl+'&next=https://evil.invalid'));
 for(const bad of ['https://evil.invalid/auth/youtube/start?state='+state,api+'/other?state='+state,api+'/auth/youtube/start?state=bad','javascript:alert(1)'])assert.throws(()=>publishingAuthorizationUrl(api,bad));
});
test('actual backend errors have actionable descriptions and malformed status fails closed',async()=>{
 assert.match(publishingErrorMessage('shorts_must_be_under_3_minutes'),/3 minutes/);
 assert.match(publishingErrorMessage('youtube_reconnect_required'),/Reconnect/);
 assert.match(publishingErrorMessage('instagram_code_exchange_failed'),/App ID, App Secret/);
 assert.match(publishingErrorMessage('instagram_connection_save_failed'),/could not save/);
 assert.match(publishingErrorMessage('instagram_session_missing'),/1CE login session/);
 assert.match(publishingErrorMessage('youtube_visibility_restricted'),/do not submit/);
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json(null);
 try{await assert.rejects(publishingRequest(api,'/status',new AbortController().signal),/Invalid publishing response/)}finally{globalThis.fetch=original;}
});
test('status exposes the owner-scoped idempotency key needed to reconcile a reload',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({available:true,connected:true,jobs:[{id:'job',requestId:'eae8d6c1-88b3-4c84-a605-b56e2982bd0a',title:'Track',state:'queued',targets:[]}]});
 try{
  const status=await publishingRequest(api,'/status',new AbortController().signal);
  assert.equal(status.jobs[0].requestId,'eae8d6c1-88b3-4c84-a605-b56e2982bd0a');
  globalThis.fetch=async()=>Response.json({available:true,connected:true,jobs:[{id:'job',title:'Track',state:'queued',targets:[]}]});
  await assert.rejects(publishingRequest(api,'/status',new AbortController().signal),/Invalid publishing status/);
 }finally{globalThis.fetch=original;}
});
test('signed upload destinations must be private R2 HTTPS URLs',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({id:12,uploadUrl:'https://evil.invalid/file'})};
 try{await assert.rejects(uploadPublishingFile(api,new File(['image'],'cover.png'),'cover',new AbortController().signal),/Invalid storage upload URL/);assert.equal(calls,1)}finally{globalThis.fetch=original;}
});

test('upload reports exact network boundary and never queues publication on fetch failure',async()=>{
 const original=globalThis.fetch;
 const file=new File(['fixture-audio'],'beat.mp3');
 const scenarios=[
  {step:1,expected:/Could not contact the 1CE upload API/,calls:1},
  {step:2,expected:/could not send the audio to Cloudflare R2/i,calls:2},
  {step:3,expected:/Could not confirm the audio upload/i,calls:3}
 ];
 try{
  for(const scenario of scenarios){
   const stages=[],requests=[];
   globalThis.fetch=async(url,options)=>{
    requests.push({url,options});
    if(requests.length===scenario.step)throw new TypeError('Failed to fetch');
    if(requests.length===1)return Response.json({id:11,uploadUrl:'https://fixture.r2.cloudflarestorage.com/object'});
    if(requests.length===2)return new Response(null,{status:200});
    return Response.json({id:11});
   };
   await assert.rejects(
    uploadPublishingFile(api,file,'audio',new AbortController().signal,stage=>stages.push(stage)),
    scenario.expected);
   assert.equal(requests.length,scenario.calls);
   assert.ok(stages.length>0);
   assert.equal(requests.some(req=>String(req.url).includes('/api/publishing/jobs')),false);
   if(scenario.step===2)assert.match(stages.at(-1),/Sending audio to secure storage/);
   if(scenario.step===3)assert.match(stages.at(-1),/Verifying audio upload/);
  }
 }finally{globalThis.fetch=original;}
});
test('successful upload exposes safe file progress without leaking signed URLs',async()=>{
 const original=globalThis.fetch,steps=[];
 globalThis.fetch=async(url)=>{
  if(String(url).endsWith('/init'))return Response.json({id:21,uploadUrl:'https://fixture.r2.cloudflarestorage.com/opaque-secret?signature=private'});
  if(String(url).includes('r2.cloudflarestorage.com'))return new Response(null,{status:200});
  return Response.json({id:21});
 };
 try{
  assert.equal(await uploadPublishingFile(api,new File(['audio'],'sample.mp3'),'audio',new AbortController().signal,
   message=>steps.push(message)),21);
  assert.deepEqual(steps,['Checking audio file…','Starting audio upload…','Sending audio to secure storage…','Verifying audio upload…','Audio ready.']);
  assert.doesNotMatch(steps.join(' '),/opaque-secret|signature=private/);
 }finally{globalThis.fetch=original;}
});

test('TikTok connection status distinguishes OAuth from draft upload availability',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({available:true,connected:true,
   tiktok:{available:false,connected:false,publishingEnabled:false},jobs:[]});
  const result=await publishingRequest(api,'/status',new AbortController().signal);
  assert.equal(result.tiktok.available,false);
  const connected={available:true,connected:true,publishingEnabled:true,nickname:'Artist',connectionId:'generation'};
  globalThis.fetch=async()=>Response.json({available:true,connected:true,tiktok:connected,jobs:[]});
  assert.deepEqual((await publishingRequest(api,'/status',new AbortController().signal)).tiktok,connected);
  for(const connectionId of [42,'','  ']){
   globalThis.fetch=async()=>Response.json({available:true,connected:true,tiktok:{...connected,connectionId},jobs:[]});
   await assert.rejects(publishingRequest(api,'/status',new AbortController().signal),/Invalid TikTok publishing status/);
  }
  globalThis.fetch=async()=>Response.json({available:true,connected:true,
   tiktok:{available:true,connected:true,publishingEnabled:'true'},jobs:[]});
  await assert.rejects(publishingRequest(api,'/status',new AbortController().signal),/Invalid TikTok publishing status/);
  assert.match(publishingErrorMessage('tiktok_scope_not_approved'),/video\.upload/);
 }finally{globalThis.fetch=original;}
});
