import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../src/multi-platform-upload-v2.tsx',import.meta.url),'utf8');
const submit=source.slice(source.indexOf(' const submit='),source.indexOf(' const visualUrl='));
const code=transformSync(`function run(ctx){const {act,accepted,setAccepted,currentStatus,video,audioFile,image,title,selectedPlatforms,pending,setNotice,uploadPublishingFile,api,description,hashtags,privacy,selectedYouTubeFormats,publishingRequest,userId,requestIdForPublishingIntent,reconcilePublishingRequestIds}=ctx;${submit};submit();}`,{loader:'ts'}).code;
const run=new Function(code+';return run;')();
function fixture(){
 let work;const requests=[],uploads=[];
 const ctx={act:fn=>{work=fn(new AbortController().signal)},currentStatus:{available:true,connected:true},video:null,audioFile:{name:'audio.mp3'},image:{name:'cover.png'},title:'fixture',selectedPlatforms:['YouTube'],pending:{current:null},setNotice:()=>{},api:'https://api.invalid',description:'',hashtags:'',privacy:'private',selectedYouTubeFormats:['vertical','horizontal'],userId:42,requestIdForPublishingIntent:async()=>`idempotent-uuid-${requests.length}`,
 reconcilePublishingRequestIds:()=>{},accepted:false,setAccepted:value=>{ctx.accepted=value},uploadPublishingFile:async(_api,_file,kind)=>{uploads.push(kind);return kind==='audio'?1:2},publishingRequest:async(_api,_path,_signal,body)=>{requests.push(JSON.stringify(body));if(requests.length===1)throw Error('Transport lost');return{id:'job',state:'queued'}}};
 return{ctx,requests,uploads,start(){run(ctx);return work}};
}
test('actual submit body keeps UUID/payload after lost response and reuses uploaded IDs',async()=>{
 const f=fixture();await assert.rejects(f.start());await f.start();
 assert.equal(f.requests.length,2);assert.equal(f.requests[0],f.requests[1]);assert.deepEqual(f.uploads,['audio','cover']);
 const body=JSON.parse(f.requests[1]);assert.equal(body.privacy,'private');assert.deepEqual(body.targets,[{platform:'youtube',variant:'shorts'},{platform:'youtube',variant:'standard'}]);
 assert.equal(f.ctx.accepted,true);await f.start();assert.equal(f.requests.length,2,'Repeated click after acceptance cannot create a new request');
});
test('unsupported destinations, video and disconnected status do not upload or submit',async()=>{
 for(const modify of [f=>f.ctx.video={},f=>f.ctx.selectedPlatforms=['YouTube','Discord'],f=>f.ctx.selectedPlatforms=['Instagram'],f=>f.ctx.selectedPlatforms=['YouTube','Instagram'],f=>f.ctx.currentStatus.connected=false,f=>f.ctx.currentStatus.available=false]){
  const f=fixture();modify(f);await f.start();assert.equal(f.uploads.length,0);assert.equal(f.requests.length,0);
 }
});

test('Instagram-only publish action is the explicit public intent, without an extra checkbox',async()=>{
 const f=fixture();f.ctx.selectedPlatforms=['Instagram'];
 f.ctx.currentStatus.instagram={available:true,connected:true,username:'artist',publishingEnabled:true};
 await assert.rejects(f.start());await f.start();
 const body=JSON.parse(f.requests[1]);
 assert.equal(body.instagramPublicConsent,true);
 assert.deepEqual(body.targets,[{platform:'instagram',variant:'default'}]);
 assert.deepEqual(f.uploads,['audio','cover']);
});
test('mixed YouTube and Instagram jobs keep private YouTube and explicit public Instagram action',async()=>{
 const f=fixture();f.ctx.selectedPlatforms=['YouTube','Instagram'];
 f.ctx.currentStatus.instagram={available:true,connected:true,username:'artist',publishingEnabled:true};
 await assert.rejects(f.start());await f.start();
 const body=JSON.parse(f.requests[1]);
 assert.equal(body.instagramPublicConsent,true);assert.equal(body.privacy,'private');
 assert.deepEqual(body.targets,[{platform:'youtube',variant:'shorts'},
  {platform:'youtube',variant:'standard'},{platform:'instagram',variant:'default'}]);
 assert.deepEqual(f.uploads,['audio','cover']);
});

test('actual submit after reload and terminal status reconciles the original request instead of a second job',async()=>{
 const values=new Map(),store={get length(){return values.size},getItem:key=>values.get(key)??null,
  setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),key:index=>[...values.keys()][index]??null};
 const recoverySource=readFileSync(new URL('../src/publishing-idempotency-v2.ts',import.meta.url),'utf8');
 const mod={exports:{}};
 new Function('module','exports',transformSync(recoverySource,{loader:'ts',format:'cjs'}).code)(mod,mod.exports);
 const recovery=mod.exports,jobs=new Map();let calls=0;
 const setup=()=>{
  const f=fixture();f.ctx.requestIdForPublishingIntent=(owner,intent)=>recovery.requestIdForPublishingIntent(owner,intent,store);
  f.ctx.reconcilePublishingRequestIds=(owner,ids)=>recovery.reconcilePublishingRequestIds(owner,ids,store);
  f.ctx.publishingRequest=async(_api,_path,_signal,payload)=>{
   jobs.set(payload.requestId,{id:'original-job',state:'succeeded'});
   if(++calls===1)throw Error('POST committed; response lost');
   return jobs.get(payload.requestId);
  };
  return f;
 };
 await assert.rejects(setup().start(),/response lost/);
 recovery.reconcilePublishingRequestIds(42,[...jobs.keys()],store);
 const reloaded=setup();await reloaded.start();
 assert.equal(jobs.size,1);assert.equal(reloaded.ctx.accepted,true);
});

test('unavailable durable storage stops actual submit before POST /jobs',async()=>{
 const f=fixture();f.ctx.requestIdForPublishingIntent=async()=>{throw Error('Enable site storage')};
 await assert.rejects(f.start(),/Enable site storage/);assert.equal(f.requests.length,0);
});
