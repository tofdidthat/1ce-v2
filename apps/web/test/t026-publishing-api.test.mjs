import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadPublishingFile} from '../src/upload-file-v2.ts';
import {publishingRequest,canRetryPublishingTarget} from '../src/publishing-api-v2.ts';
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
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return calls.length===1?Response.json({id:12,uploadUrl:'https://storage.invalid/signed'}):Response.json({id:12})};
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
