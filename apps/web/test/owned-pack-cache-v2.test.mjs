import test from 'node:test';
import assert from 'node:assert/strict';
import {findOwnProjectV2,OwnedPackCacheV2} from '../src/owned-pack-cache-v2.ts';

test('profile fast path only reads projects verified for the active owner',()=>{
 const projects=[{id:'a',owner_id:1},{id:'b',owner_id:2}];
 assert.equal(findOwnProjectV2(1,1,1,'a',projects),projects[0]);
 assert.equal(findOwnProjectV2(1,1,2,'b',projects),undefined);
 assert.equal(findOwnProjectV2(2,1,2,'b',projects),undefined);
 assert.equal(findOwnProjectV2(undefined,1,1,'a',projects),undefined);
});

test('only the active owner can reuse tracks and account switches clear them',()=>{
 const cache=new OwnedPackCacheV2();cache.setViewer(1);
 cache.put(1,1,'pack',['track'],cache.token());
 assert.deepEqual(cache.get(1,1,'pack'),['track']);
 assert.equal(cache.get(1,2,'pack'),undefined);
 cache.setViewer(2);assert.equal(cache.get(2,1,'pack'),undefined);
 cache.setViewer(1);assert.equal(cache.get(1,1,'pack'),undefined);
});

test('invalidation rejects late responses and retains empty packs',()=>{
 const cache=new OwnedPackCacheV2();cache.setViewer(1);
 const old=cache.token();cache.clear();cache.put(1,1,'pack',['stale'],old);
 assert.equal(cache.get(1,1,'pack'),undefined);
 cache.put(1,1,'pack',[],cache.token());assert.deepEqual(cache.get(1,1,'pack'),[]);
 cache.clear();assert.equal(cache.get(1,1,'pack'),undefined);
});
