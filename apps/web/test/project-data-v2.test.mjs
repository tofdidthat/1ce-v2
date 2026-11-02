import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeViewerProjectFlagsV2,savedProjectKeyV2,publishedProjectKeyV2} from '../src/project-identity-v2.ts';

test('canonical project identity separates owner, kind and project ID',()=>{
 assert.equal(savedProjectKeyV2(7,'beat','same-id'),'7:beat:same-id');
 assert.notEqual(savedProjectKeyV2(7,'beat','same-id'),savedProjectKeyV2(8,'beat','same-id'));
 assert.notEqual(savedProjectKeyV2(7,'beat','same-id'),savedProjectKeyV2(7,'pack','same-id'));
 assert.equal(publishedProjectKeyV2('pack','same-id'),'pack:same-id');
});

test('viewer flags normalize saves from all owners but publication from the viewer',()=>{
 const mine=normalizeViewerProjectFlagsV2(15,{
  saved:[{owner_id:15,kind:'beat',id:'a'},{owner_id:27,kind:'pack',id:'b'}],
  published:[{kind:'beat',id:'a'}]
 });
 assert.equal(mine.viewerId,15);
 assert.equal(mine.saved.size,2);
 assert.ok(mine.saved.has('15:beat:a'));
 assert.ok(mine.saved.has('27:pack:b'));
 assert.ok(mine.published.has('beat:a'));
 assert.equal(mine.published.size,1);
});

test('missing or invalid /mine payload never creates affirmative flags',()=>{
 for(const payload of [null,{},false,[],{saved:null,published:'bad'}]){
  const flags=normalizeViewerProjectFlagsV2(2,payload);
  assert.equal(flags.saved.size,0);
  assert.equal(flags.published.size,0);
 }
 const flags=normalizeViewerProjectFlagsV2(2,{
  saved:[null,{},'bad',{owner_id:0,kind:'beat',id:'a'},{owner_id:1,kind:'bundle',id:'b'},{owner_id:1,kind:'beat',id:''},{owner_id:1,kind:'beat',id:'valid'}],
  published:[null,{kind:'unknown',id:'bad'},{kind:'pack',id:'okay'}]
 });
 assert.deepEqual([...flags.saved],['1:beat:valid']);
 assert.deepEqual([...flags.published],['pack:okay']);
});
