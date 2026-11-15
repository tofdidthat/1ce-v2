import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
// Execute the production fetch effect, with controlled transport and setters.
// This verifies request/abort/late-result behavior, not React DOM or batching.
const source=readFileSync(new URL('../src/public-profile-v2.tsx',import.meta.url),'utf8');
const end=source.indexOf(' const toggleSave=');
const start=source.lastIndexOf(' React.useEffect(()=>{',end);
const effect=source.slice(start,end);
const code=transformSync(`function run(ctx){const {React,active,api,targetId,requestKey,refreshRevision,setLoadState,setError,fetch,lastVerifiedProfileKey,setProjects,setProfileUser,isPublicProfileIdentityV2,normalizeProfileProjectsV2}=ctx;${effect}}`,{loader:'ts',format:'cjs'}).code;
const run=new Function(code+';return run;')();
function fixture(active=true){
 const requests=[],writes=[];let cleanup,previousDeps;
 const ctx={active,api:'https://api.invalid',targetId:'artist',requestKey:'7:artist',refreshRevision:0,
  React:{useEffect(fn,deps){if(previousDeps&&deps.every((v,i)=>Object.is(v,previousDeps[i])))return;cleanup?.();previousDeps=deps;cleanup=fn();}},
  setLoadState:v=>writes.push(['state',v]),setError:v=>writes.push(['error',v]),
  setProjects:v=>writes.push(['projects',v]),setProfileUser:v=>writes.push(['profile',v]),
  lastVerifiedProfileKey:{current:''},isPublicProfileIdentityV2:()=>true,normalizeProfileProjectsV2:v=>v,
  fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))};
 return {ctx,requests,writes,start(){run(ctx)},stop(){cleanup?.()}};
}
test('inactive retained profiles issue zero requests for owner, second account and anonymous',()=>{
 for(const viewer of ['7','9','anonymous']){
  const f=fixture(false);f.ctx.requestKey=viewer+':artist';f.start();
  assert.equal(f.requests.length,0);assert.equal(f.writes.length,0);
 }
});
test('active profile fetch aborts on deactivation and ignores late private data',async()=>{
 const f=fixture();f.start();assert.equal(f.requests.length,1);
 f.ctx.active=false;f.start();
 assert.equal(f.requests[0].options.signal.aborted,true);
 f.requests[0].resolve({ok:true,json:async()=>({profile:{id:7}})});
 await new Promise(setImmediate);
 assert.equal(f.writes.filter(([key])=>key==='profile').length,0);
 assert.equal(f.requests.length,1);
 f.ctx.active=true;f.start();assert.equal(f.requests.length,2);
 f.stop();
});
test('active access revocation removes previously verified projects',async()=>{
 const f=fixture();f.ctx.lastVerifiedProfileKey.current='7:artist';f.start();
 f.requests[0].resolve({ok:false,status:403});await new Promise(setImmediate);
 assert.equal(f.ctx.lastVerifiedProfileKey.current,'');
 assert.deepEqual(f.writes.find(([key])=>key==='projects')[1],{catalog:[],saves:[]});
 f.stop();
});

