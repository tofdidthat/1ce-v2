import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';

const source=readFileSync(new URL('../src/publishing-idempotency-v2.ts',import.meta.url),'utf8');
const module={exports:{}};
new Function('module','exports',transformSync(source,{loader:'ts',format:'cjs'}).code)(module,module.exports);
const {requestIdForPublishingIntent,reconcilePublishingRequestIds}=module.exports;

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

test('known terminal jobs clear their matching recovery key; ambiguous jobs keep it',async()=>{
 const shared=storage(),requestId=await requestIdForPublishingIntent(42,intent,shared,1000);
 reconcilePublishingRequestIds(42,[],shared,2000);
 assert.equal(shared.length,1);
 reconcilePublishingRequestIds(42,[requestId],shared,3000);
 assert.equal(shared.length,0);
});

test('expired recovery keys are replaced with a new id',async()=>{
 const shared=storage(),first=await requestIdForPublishingIntent(42,intent,shared,1000);
 const next=await requestIdForPublishingIntent(42,intent,shared,31*24*60*60*1000);
 assert.notEqual(next,first);
});

test('restricted local storage does not break publishing or status cleanup',async()=>{
 const unavailable={length:0,getItem(){throw Error('storage blocked')},setItem(){throw Error('storage blocked')},removeItem(){throw Error('storage blocked')},key(){throw Error('storage blocked')}};
 const requestId=await requestIdForPublishingIntent(42,intent,unavailable,1000);
 assert.match(requestId,/^[0-9a-f-]{36}$/i);
 assert.doesNotThrow(()=>reconcilePublishingRequestIds(42,[requestId],unavailable,1000));
});
