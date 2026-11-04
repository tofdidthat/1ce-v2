import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadLimits} from '../dist/api-rate-limits.js';
import {accountStorageQuota,GIB} from '../dist/storage-plans.js';

test('storage entitlement falls back to seeded default for unassigned account',async()=>{
 const db={query:async(sql,args)=>{
  assert.match(sql,/v2_storage_plans/);
  assert.match(sql,/v2_account_storage_plans/);
  assert.deepEqual(args,[42]);
  return {rows:[{storage_limit_bytes:String(10*GIB)}]};
 }};
 assert.equal(await accountStorageQuota(db,42),10*GIB);
 assert.equal(uploadLimits.maxPending,10);
});
test('separate accounts may receive distinct DB-controlled quotas',async()=>{
 const assigned=new Map([[1,10*GIB],[2,40*GIB],[3,100*GIB]]);
 const db={query:async(sql,[id])=>({rows:[{storage_limit_bytes:String(assigned.get(id))}]})};
 for(const [userId,quota] of assigned)assert.equal(await accountStorageQuota(db,userId),quota);
});
test('storage entitlement rejects missing or unsafe quota values',async()=>{
 for(const invalid of [undefined,'0','123','NaN','Infinity',null,'1099511627777']){
  const db={query:async()=>({rows:[{storage_limit_bytes:invalid}]})};
  await assert.rejects(()=>accountStorageQuota(db,10),/Storage entitlement unavailable/);
 }
 await assert.rejects(()=>accountStorageQuota({query:async()=>({rows:[]})},10),/Storage entitlement unavailable/);
 await assert.rejects(()=>accountStorageQuota({query:async()=>({rows:[]})},0),/Invalid storage account/);
});
