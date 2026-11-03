import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ProjectCoverCacheV2} from '../src/project-cover-cache-v2.ts';

const image=(bytes=4,type='image/png')=>new Blob([new Uint8Array(bytes)],{type});
function setup(loader,options={}){
 const revoked=[];
 let sequence=0;
 const cache=new ProjectCoverCacheV2(loader,{
  makeUrl:()=>`blob:cover-${++sequence}`,
  revokeUrl:url=>revoked.push(url),
  ...options
 });
 return {cache,revoked};
}

test('cards and player share one in-flight request and reuse the same URL on remount',async()=>{
 let calls=0,resolve;
 const pending=new Promise(done=>{resolve=done});
 const {cache,revoked}=setup(async()=>{calls++;return pending});
 const card=cache.acquire(2,17);
 const player=cache.acquire(2,17);
 assert.equal(calls,1);
 resolve(image());
 assert.equal(await card.ready,'blob:cover-1');
 assert.equal(await player.ready,'blob:cover-1');
 assert.equal(cache.peek(2,17),'blob:cover-1');
 card.release();player.release();
 const remounted=cache.acquire(2,17);
 assert.equal(remounted.url,'blob:cover-1');
 assert.equal(await remounted.ready,'blob:cover-1');
 assert.equal(calls,1);
 remounted.release();
 cache.clear();
 assert.deepEqual(revoked,['blob:cover-1']);
});

test('different original owners, cover IDs and viewer cache instances never share URLs',async()=>{
 let calls=0;
 const loader=async()=>{calls++;return image()};
 const a=setup(loader),b=setup(loader);
 const leases=[a.cache.acquire(1,4),a.cache.acquire(2,4),a.cache.acquire(1,5),b.cache.acquire(1,4)];
 await Promise.all(leases.map(x=>x.ready));
 assert.equal(calls,4);
 assert.equal(a.cache.peek(1,4),'blob:cover-1');
 assert.equal(a.cache.peek(2,4),'blob:cover-2');
 assert.equal(a.cache.peek(1,5),'blob:cover-3');
 assert.equal(b.cache.peek(1,4),'blob:cover-1'); // Separate URL registries in test; separate cache ownership.
 leases.forEach(x=>x.release());
 a.cache.clear();b.cache.clear();
 assert.equal(a.cache.peek(1,4),null);
 assert.equal(b.cache.peek(1,4),null);
});

test('unused covers expire and are revalidated without clearing currently mounted covers',async()=>{
 let clock=1000,calls=0;
 const {cache,revoked}=setup(async()=>{calls++;return image()}, {ttlMs:100,now:()=>clock});
 const held=cache.acquire(1,1);await held.ready;
 clock=1200;
 assert.equal(cache.peek(1,1),'blob:cover-1'); // Mounted image remains valid.
 held.release();
 assert.equal(cache.peek(1,1),null);
 assert.deepEqual(revoked,['blob:cover-1']);
 const again=cache.acquire(1,1);
 assert.equal(await again.ready,'blob:cover-2');
 assert.equal(calls,2);
 again.release();cache.clear();
});

test('LRU and byte budget evict only unused URLs and revoke them',async()=>{
 const {cache,revoked}=setup(async()=>image(4),{maxEntries:2,maxBytes:8});
 const first=cache.acquire(1,1);await first.ready;first.release();
 const second=cache.acquire(1,2);await second.ready;second.release();
 const third=cache.acquire(1,3);await third.ready;
 assert.equal(cache.peek(1,1),null);
 assert.equal(cache.peek(1,2),'blob:cover-2');
 assert.equal(cache.peek(1,3),'blob:cover-3');
 assert.ok(revoked.includes('blob:cover-1'));
 third.release();cache.clear();
});

test('failed and non-image responses are never cached and may retry',async()=>{
 let calls=0;
 const {cache}=setup(async()=>{
  calls++;
  if(calls===1)throw Error('403');
  if(calls===2)return image(2,'text/html');
  return image();
 });
 for(let i=0;i<2;i++){
  const lease=cache.acquire(1,2);
  assert.equal(await lease.ready,null);
  lease.release();
  assert.equal(cache.peek(1,2),null);
 }
 const recovered=cache.acquire(1,2);
 assert.equal(await recovered.ready,'blob:cover-1');
 assert.equal(calls,3);
 recovered.release();cache.clear();
});

test('viewer switch or workspace teardown aborts pending requests and prevents late URLs',async()=>{
 let resolve,signal;
 const pending=new Promise(done=>{resolve=done});
 const {cache,revoked}=setup(async(_owner,_file,s)=>{signal=s;return pending});
 const lease=cache.acquire(1,5);
 assert.equal(signal.aborted,false);
 cache.clear();
 assert.equal(signal.aborted,true);
 resolve(image());
 assert.equal(await lease.ready,null);
 assert.equal(cache.peek(1,5),null);
 assert.deepEqual(revoked,[]);
 lease.release();
});

test('shared provider covers Library, Catalog, Saves and player; no persistent storage or audio changes',()=>{
 const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
 const cover=read('project-cover-v2.tsx');
 const workspace=read('workspace-v1.tsx');
 const library=read('library-items-v2.tsx');
 const card=read('project-card-v2.tsx');
 const cache=read('project-cover-cache-v2.ts');
 assert.match(workspace,/<ProjectCoverCacheProviderV2 viewerId=\{Number\(account\?\.id\)\|\|null\}>/);
 assert.match(cover,/const cache=useMemo\(\(\)=>new ProjectCoverCacheV2\(loadAuthorizedCover\),\[viewerId\]\)/);
 assert.match(cover,/loaded\?\.cache===cache&&loaded.key===key/);
 assert.match(cover,/credentials:'include',cache:'no-store'/);
 assert.match(card,/<ProjectCoverV2/);
 assert.match(library,/useProjectCoverUrlV2\(current\?\.owner_id/);
 assert.doesNotMatch(library,/setCoverLoadedId|setCoverUrl|URL.createObjectURL/);
 assert.doesNotMatch(cache,/localStorage|indexedDB|caches\.open/);
 assert.match(library,/audioRef\.current/);
});
