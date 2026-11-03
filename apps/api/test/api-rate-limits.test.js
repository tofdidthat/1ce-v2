import test from 'node:test';
import assert from 'node:assert/strict';
import {storageQuotaBytes,uploadLimits} from '../src/api-rate-limits.js';

const GiB=1024*1024*1024;
test('storage capacity remains conservatively capped when no product policy is configured',()=>{
 assert.equal(storageQuotaBytes({}),10*GiB);
 assert.equal(storageQuotaBytes({V2_MAX_STORED_GIB:''}),10*GiB);
 assert.equal(uploadLimits.maxPending,10);
});
test('operator-approved capacity can be configured without changing code',()=>{
 for(const size of [1,10,25,100,1024])
  assert.equal(storageQuotaBytes({V2_MAX_STORED_GIB:String(size)}),size*GiB);
});
test('capacity configuration never silently means unlimited or fractional bytes',()=>{
 for(const bad of ['0','-1','1.5',' 20 ','Infinity','NaN','9999','unlimited',null])
  assert.throws(()=>storageQuotaBytes({V2_MAX_STORED_GIB:bad}),/V2_MAX_STORED_GIB/);
});
