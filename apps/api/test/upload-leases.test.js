import test from 'node:test';
import assert from 'node:assert/strict';
import {
 acquireCompletionLease,
 releaseCompletionLease,
 promoteReadyWithLease,
 failPendingWithLease,
 discardPendingWithLease
} from '../dist/upload-leases.js';

const mockDb=(rowCount=1)=>{
 const calls=[];
 return {
  calls,
  async query(sql,params=[]){
   calls.push({sql,params});
   return {rowCount,rows:[]};
  }
 };
};

test('completion lease acquisition is scoped to pending owner media and rejects occupied leases',async()=>{
 const db=mockDb();
 const token=await acquireCompletionLease(db,17,42);
 assert.match(token,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
 const call=db.calls[0];
 assert.deepEqual(call.params,[17,token,42]);
 assert.match(call.sql,/WHERE id=\$1 AND user_id=\$3 AND status='pending'/);
 assert.match(call.sql,/created_at>now\(\)-interval '30 minutes'/);
 assert.match(call.sql,/v2_upload_completion_leases\.expires_at<now\(\)/);
 assert.match(call.sql,/RETURNING lease_token/);
 assert.equal(await acquireCompletionLease(mockDb(0),17,42),null);
});

test('release deletes only the matching file and lease token',async()=>{
 const db=mockDb();
 await releaseCompletionLease(db,17,'lease-token-1');
 assert.deepEqual(db.calls[0].params,[17,'lease-token-1']);
 assert.match(db.calls[0].sql,/DELETE FROM v2_upload_completion_leases WHERE file_id=\$1 AND lease_token=\$2::uuid/);
});

test('all terminal upload transitions require the unexpired token and row lock',async()=>{
 const db=mockDb();
 const lease={fileId:17,ownerId:42,token:'lease-token-1'};
 await promoteReadyWithLease(db,{...lease,finalKey:'users/42/verified/17'});
 await failPendingWithLease(db,lease);
 await discardPendingWithLease(db,lease);
 assert.equal(db.calls.length,3);
 for(const {sql} of db.calls){
  assert.match(sql,/WITH active_lease AS MATERIALIZED/);
  assert.match(sql,/expires_at>clock_timestamp\(\)/);
  assert.match(sql,/FOR UPDATE/);
  assert.match(sql,/AND id IN \(SELECT file_id FROM active_lease\)/);
  assert.match(sql,/WHERE id=\$1 AND user_id=\$2 AND status='pending'/);
 }
 assert.deepEqual(db.calls[0].params,[17,42,'users/42/verified/17','lease-token-1']);
 assert.match(db.calls[0].sql,/lease_token=\$4::uuid/);
 assert.match(db.calls[0].sql,/UPDATE library_files SET object_key=\$3,status='ready'/);
 assert.deepEqual(db.calls[1].params,[17,42,'lease-token-1']);
 assert.match(db.calls[1].sql,/lease_token=\$3::uuid/);
 assert.match(db.calls[1].sql,/UPDATE library_files SET status='failed'/);
 assert.deepEqual(db.calls[2].params,[17,42,'lease-token-1']);
 assert.match(db.calls[2].sql,/DELETE FROM library_files/);
});
