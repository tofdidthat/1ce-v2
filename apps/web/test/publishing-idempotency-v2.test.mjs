import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';

const source=readFileSync(new URL('../src/publishing-idempotency-v2.ts',import.meta.url),'utf8');
const module={exports:{}};
new Function('module','exports',transformSync(source,{loader:'ts',format:'cjs'}).code)(module,module.exports);
const {requestIdForPublishingIntent,reconcilePublishingRequestIds,beginAnotherPublishingRequest}=module.exports;

function storage(){
 const values=new Map();
 return {get length(){return values.size},getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),
  removeItem:key=>values.delete(key),key:index=>[...values.keys()][index]??null,values};
}
const intent={title:'Track',description:'Caption',hashtags:'#beat',privacy:'private',audioFileId:101,coverFileId:202,
 targets:[{platform:'instagram',variant:'default'}],instagramPublicConsent:true};

test('same account and exact intent reuse an opaque request id across tabs; changed intent or account does not',async()=>{
 const shared=storage();
 const first=await requestIdForPublishingIntent(42,intent,shared,1000);
 const second=await requestIdForPublishingIntent(42,{...intent},shared,2000);
 const reordered=await requestIdForPublishingIntent(42,{...intent,targets:[...intent.targets].reverse()},shared,2000);
 const changed=await requestIdForPublishingIntent(42,{...intent,title:'Different'},shared,2000);
 const otherAccount=await requestIdForPublishingIntent(43,intent,shared,2000);
 assert.equal(second,first);assert.equal(reordered,first);assert.notEqual(changed,first);assert.notEqual(otherAccount,first);
 assert.match(first,/^[0-9a-f-]{36}$/i);
 const stored=[...shared.values.values()].map(JSON.parse);
 assert.deepEqual(Object.keys(stored[0]).sort(),['createdAt','requestId']);
 assert.equal(stored.some(value=>Object.values(value).some(entry=>String(entry).includes('Track')||String(entry).includes('Caption'))),false,
  'local storage contains only request id and expiry metadata');
});

test('a terminal job discovered after a lost POST response keeps its UUID across reload',async()=>{
 const shared=storage(),requestId=await requestIdForPublishingIntent(42,intent,shared,1000);
 reconcilePublishingRequestIds(42,[],shared,2000);
 assert.equal(shared.length,1);
 reconcilePublishingRequestIds(42,[requestId],shared,3000);
 assert.equal(shared.length,1);
 assert.equal(await requestIdForPublishingIntent(42,intent,shared,4000),requestId);
 beginAnotherPublishingRequest(42,requestId,shared);
 assert.notEqual(await requestIdForPublishingIntent(42,intent,shared,5000),requestId,
  'only an explicit start-another action after acknowledgement creates a new attempt');
});

test('old unresolved attempts do not silently turn into a duplicate job',async()=>{
 const shared=storage(),first=await requestIdForPublishingIntent(42,intent,shared,1000);
 const next=await requestIdForPublishingIntent(42,intent,shared,31*24*60*60*1000);
 assert.equal(next,first);
 assert.throws(()=>beginAnotherPublishingRequest(42,first,shared),/save this publication/);
});

test('restricted or corrupt local storage prevents submission with an unrecoverable UUID',async()=>{
 const unavailable={length:0,getItem(){throw Error('storage blocked')},setItem(){throw Error('storage blocked')},removeItem(){throw Error('storage blocked')},key(){throw Error('storage blocked')}};
 await assert.rejects(requestIdForPublishingIntent(42,intent,unavailable,1000),/Enable site storage/);
 assert.doesNotThrow(()=>reconcilePublishingRequestIds(42,[],unavailable,1000));
 const shared=storage();await requestIdForPublishingIntent(42,intent,shared,1000);
 shared.setItem(shared.key(0),'{corrupt');
 await assert.rejects(requestIdForPublishingIntent(42,intent,shared,1000),/Enable site storage/);
});
