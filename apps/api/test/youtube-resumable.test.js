import test from 'node:test';
import assert from 'node:assert/strict';
import {beginYouTubeUpload,validateYouTubeSessionUri,probeYouTubeUpload,
 sendYouTubeChunk} from '../dist/youtube-resumable.js';

const session='https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=abc123&part=snippet,status';
const auth='test-only-token-not-a-real-credential';
test('YouTube session initiation is private, guarded and uses correct metadata',async()=>{
 const calls=[];
 const http=async(url,init)=>{
  calls.push({url,init});
  return new Response(null,{status:200,headers:{Location:session}});
 };
 assert.equal(await beginYouTubeUpload({accessToken:auth,title:'Original beat',totalBytes:524288,http}),session);
 assert.equal(calls.length,1);
 assert.match(calls[0].url,/uploadType=resumable/);
 assert.equal(calls[0].init.redirect,'manual');
 assert.equal(calls[0].init.headers.Authorization,'Bearer '+auth);
 assert.equal(calls[0].init.headers['X-Upload-Content-Length'],'524288');
 assert.equal(calls[0].init.headers['X-Upload-Content-Type'],'video/mp4');
 const body=JSON.parse(calls[0].init.body);
 assert.equal(body.snippet.title,'Original beat');
 assert.equal(body.status.privacyStatus,'private','Do not publish public by default');
});
test('reject untrusted YouTube upload session locations before any bearer send',async()=>{
 for(const bad of [
  'http://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=x',
  'https://www.googleapis.com.evil.invalid/upload/youtube/v3/videos?uploadType=resumable&upload_id=x',
  'https://www.googleapis.com@evil.invalid/upload/youtube/v3/videos?uploadType=resumable&upload_id=x',
  'https://www.googleapis.com:444/upload/youtube/v3/videos?uploadType=resumable&upload_id=x',
  'https://www.googleapis.com/anything?uploadType=resumable&upload_id=x',
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable',
  'file:///etc/passwd'
 ])assert.throws(()=>validateYouTubeSessionUri(bad),/Invalid YouTube upload session/);
 await assert.rejects(()=>beginYouTubeUpload({accessToken:auth,title:'Test',totalBytes:10,
  http:async()=>new Response(null,{status:200,headers:{Location:'https://bad.invalid/upload_id'}})}),
 /Invalid YouTube upload session/);
});
test('status probe resumes from server-acknowledged offset and never assumes upload succeeded',async()=>{
 const calls=[];
 const http=async(url,init)=>{
  calls.push({url,init});
  return new Response(null,{status:308,headers:{Range:'bytes=0-262143','Retry-After':'2'}});
 };
 const result=await probeYouTubeUpload({sessionUri:session,accessToken:auth,totalBytes:524288,http});
 assert.deepEqual(result,{state:'pending',nextByte:262144,retryAfterSeconds:2});
 assert.equal(calls[0].init.method,'PUT');
 assert.equal(calls[0].init.headers['Content-Range'],'bytes */524288');
 assert.equal(calls[0].init.headers['Content-Length'],'0');
 assert.equal(calls[0].init.redirect,'manual');
 const empty=await probeYouTubeUpload({sessionUri:session,accessToken:auth,totalBytes:524288,
  http:async()=>new Response(null,{status:308})});
 assert.deepEqual(empty,{state:'pending',nextByte:0,retryAfterSeconds:null});
});
test('chunk protocol uses correct byte range and validates server completion',async()=>{
 const calls=[];
 const http=async(url,init)=>{
  calls.push({url,init});return new Response(null,{status:308,headers:{Range:'bytes=0-262143'}});
 };
 const first=await sendYouTubeChunk({sessionUri:session,accessToken:auth,totalBytes:524288,
  start:0,bytes:new Uint8Array(262144),http});
 assert.equal(first.nextByte,262144);
 assert.equal(calls[0].init.headers['Content-Range'],'bytes 0-262143/524288');
 assert.equal(calls[0].init.headers['Content-Length'],'262144');
 const success=await sendYouTubeChunk({sessionUri:session,accessToken:auth,totalBytes:524288,
  start:262144,bytes:new Uint8Array(262144),
  http:async()=>new Response(JSON.stringify({id:'xA1234B6789'}),{status:201,headers:{'Content-Type':'application/json'}})});
 assert.deepEqual(success,{state:'complete',videoId:'xA1234B6789'});
 await assert.rejects(()=>sendYouTubeChunk({sessionUri:session,accessToken:auth,totalBytes:600000,
  start:0,bytes:new Uint8Array(100),http}),/Invalid YouTube chunk boundaries/);
});
test('uncertain provider answers are quarantined instead of retried blindly',async()=>{
 for(const status of [404,401,403,500,503]){
  const result=await probeYouTubeUpload({sessionUri:session,accessToken:auth,totalBytes:400000,
   http:async()=>new Response(null,{status})});
  assert.deepEqual(result,{state:'needs_review',httpStatus:status});
 }
 await assert.rejects(()=>probeYouTubeUpload({sessionUri:session,accessToken:auth,totalBytes:524288,
  http:async()=>new Response(null,{status:308,headers:{Range:'bytes=0-999999'}})}),/progress offset/);
 await assert.rejects(()=>sendYouTubeChunk({sessionUri:session,accessToken:auth,totalBytes:524288,
  start:0,bytes:new Uint8Array(524288),http:async()=>new Response('{}',{status:201})}),/confirmation/);
});
