import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../src/multi-platform-upload-v2.tsx',import.meta.url),'utf8');
const submit=source.slice(source.indexOf(' const submit='),source.indexOf(' const visualUrl='));
const code=transformSync(`function run(ctx){const {act,currentStatus,video,audioFile,image,title,selectedPlatforms,pending,setNotice,uploadPublishingFile,api,description,hashtags,privacy,selectedYouTubeFormats,publishingRequest}=ctx;${submit};submit();}`,{loader:'ts'}).code;
const run=new Function(code+';return run;')();
function fixture(){
 let work;const requests=[],uploads=[];
 const ctx={act:fn=>{work=fn(new AbortController().signal)},currentStatus:{available:true,connected:true},video:null,audioFile:{name:'audio.mp3'},image:{name:'cover.png'},title:'fixture',selectedPlatforms:['YouTube'],pending:{current:null},setNotice:()=>{},api:'https://api.invalid',description:'',hashtags:'',privacy:'private',selectedYouTubeFormats:['vertical','horizontal'],
 uploadPublishingFile:async(_api,_file,kind)=>{uploads.push(kind);return kind==='audio'?1:2},publishingRequest:async(_api,_path,_signal,body)=>{requests.push(JSON.stringify(body));if(requests.length===1)throw Error('Transport lost');return{id:'job',state:'queued'}}};
 return{ctx,requests,uploads,start(){run(ctx);return work}};
}
test('actual submit body keeps UUID/payload after lost response and reuses uploaded IDs',async()=>{
 const f=fixture();await assert.rejects(f.start());await f.start();
 assert.equal(f.requests.length,2);assert.equal(f.requests[0],f.requests[1]);assert.deepEqual(f.uploads,['audio','cover']);
 const body=JSON.parse(f.requests[1]);assert.equal(body.privacy,'private');assert.deepEqual(body.targets,[{platform:'youtube',variant:'shorts'},{platform:'youtube',variant:'standard'}]);
 assert.equal(f.ctx.pending.current,null);
});
test('unsupported destinations, video and disconnected status do not upload or submit',async()=>{
 for(const modify of [f=>f.ctx.video={},f=>f.ctx.selectedPlatforms=['YouTube','Discord'],f=>f.ctx.currentStatus.connected=false,f=>f.ctx.currentStatus.available=false]){
  const f=fixture();modify(f);await f.start();assert.equal(f.uploads.length,0);assert.equal(f.requests.length,0);
 }
});
