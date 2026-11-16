import test from 'node:test';
import assert from 'node:assert/strict';
import {listPublications} from '../dist/publishing-jobs.js';

test('owner history returns request ids for client reconciliation after reload',async()=>{
 const requestId='eae8d6c1-88b3-4c84-a605-b56e2982bd0a',calls=[];
 const db={async query(sql,args){calls.push({sql,args});return{rows:[
  {id:'1',request_id:requestId,title:'Track',job_state:'running',target_id:'7',platform:'instagram',variant:'default',state:'needs_review',remote_id:null,last_error_code:'instagram_claim_expired'}
 ],rowCount:1}}};
 const jobs=await listPublications(db,42);
 assert.deepEqual(jobs,[{id:'1',requestId,title:'Track',state:'needs_review',targets:[
  {id:'7',platform:'instagram',variant:'default',state:'needs_review',remoteId:null,errorCode:'instagram_claim_expired'}
 ]}]);
 assert.equal(calls[0].args[0],42);
 assert.match(calls[0].sql,/j\.request_id/);
});
