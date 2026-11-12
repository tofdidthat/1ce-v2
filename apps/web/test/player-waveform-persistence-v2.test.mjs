import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({entryPoints:[new URL('../src/player-waveform-v2.ts',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],
 bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env.VITE_API_URL':JSON.stringify('https://api.invalid')}});
const source='data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64');
const bars=Array.from({length:84},(_,i)=>i/84);
const reply=(status,body)=>({status,ok:status>=200&&status<300,json:async()=>body});
test('fresh module/F5 and repeated loads fetch only small authorized waveform JSON',async()=>{
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return reply(200,{bars})};
 try{
  for(const suffix of ['#first','#reload']){
   const {loadWaveform}=await import(source+suffix);
   assert.deepEqual(await loadWaveform(15,2),bars);
  }
  assert.equal(calls.length,2);
  assert.ok(calls.every(({url,options})=>url==='https://api.invalid/api/public/waveform/2/15'&&
   options.credentials==='include'&&options.cache==='no-store'));
 }finally{globalThis.fetch=previous;}
});
test('revocation, malformed bars and aborted navigation cannot reuse an old successful result',async()=>{
 const previous=globalThis.fetch;
 const {loadWaveform}=await import(source+'#permissions');
 try{
  globalThis.fetch=async()=>reply(200,{bars});await loadWaveform(15,2);
  globalThis.fetch=async()=>reply(404,{});await assert.rejects(loadWaveform(15,2));
  globalThis.fetch=async()=>reply(200,{bars:Array(84).fill(2)});await assert.rejects(loadWaveform(15,2));
  const controller=new AbortController();controller.abort();let requests=0;
  globalThis.fetch=async()=>{requests++;return reply(200,{bars})};
  await assert.rejects(loadWaveform(15,2,controller.signal));assert.equal(requests,0);
 }finally{globalThis.fetch=previous;}
});
test('pending generation retries metadata, then returns the persisted 84 bars',async()=>{
 const previous=globalThis.fetch,timer=globalThis.setTimeout;
 const {loadWaveform}=await import(source+'#pending');let calls=0;
 try{
  globalThis.setTimeout=fn=>timer(fn,0);
  globalThis.fetch=async()=>++calls===1?reply(202,{status:'pending'}):reply(200,{bars});
  assert.deepEqual(await loadWaveform(15,2),bars);assert.equal(calls,2);
 }finally{globalThis.fetch=previous;globalThis.setTimeout=timer;}
});

