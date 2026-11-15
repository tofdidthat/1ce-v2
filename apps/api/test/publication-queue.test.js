import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parsePublicationDraft,publicationRequestHash,claimPublicationTarget,
 settlePublicationTarget,quarantineExpiredPublicationClaims} from '../dist/publication-queue.js';

const make=()=>({
 requestId:randomUUID(),title:'My beat',description:'A new track',hashtags:'#music',
 targets:[{platform:'youtube',variant:'shorts'},{platform:'youtube',variant:'standard'},
  {platform:'tiktok',variant:'default'}]
});
test('target validation isolates Shorts/standard variants to YouTube',()=>{
 const a=parsePublicationDraft(make());
 assert.equal(a.targets.length,3);
 assert.deepEqual(a.targets.filter(t=>t.platform==='youtube').map(t=>t.variant),['shorts','standard']);
 for(const bad of [
  {...make(),targets:[]},
  {...make(),targets:[{platform:'tiktok',variant:'standard'}]},
  {...make(),targets:[{platform:'instagram',variant:'shorts'}]},
  {...make(),targets:[{platform:'youtube',variant:'default'}]},
  {...make(),targets:[{platform:'other',variant:'default'}]},
  {...make(),targets:[{platform:'youtube',variant:'shorts'},{platform:'youtube',variant:'shorts'}]},
  {...make(),targets:[{platform:'youtube',variant:'shorts'}],title:''},
  {...make(),requestId:'not-a-uuid'},
  {...make(),title:'a'.repeat(101)}
 ])assert.throws(()=>parsePublicationDraft(bad),Error);
});
test('request fingerprint is stable independent of destination order and excludes idempotency nonce',()=>{
 const a=make(),b={...a,requestId:randomUUID(),targets:[...a.targets].reverse()};
 assert.equal(publicationRequestHash(parsePublicationDraft(a)),publicationRequestHash(parsePublicationDraft(b)));
 b.title='Changed title';
 assert.notEqual(publicationRequestHash(parsePublicationDraft(a)),publicationRequestHash(parsePublicationDraft(b)));
});
test('a queue does not claim draft jobs without READY state',async()=>{
 const sql=[];
 const db={async query(q){sql.push(q);return {rows:[],rowCount:0}}};
 assert.equal(await claimPublicationTarget(db),null);
 assert.match(sql[0],/j.state='ready'/);
 assert.match(sql[0],/FOR UPDATE OF t SKIP LOCKED/);
 assert.match(sql[0],/INSERT INTO v2_publication_attempts/);
});
test('completion requires fenced claim, provider confirmation and safe error codes',async()=>{
 const db={queries:[],async query(sql,args){this.queries.push({sql,args});return {rowCount:0,rows:[]}}};
 await assert.rejects(()=>settlePublicationTarget(db,'1',randomUUID(),'succeeded'),/confirmation/);
 await assert.rejects(()=>settlePublicationTarget(db,'1',randomUUID(),'retryable',{errorCode:'tokens:secret'}),/error code/);
 assert.equal(await settlePublicationTarget(db,'1',randomUUID(),'needs_review',{errorCode:'ambiguous'}),false);
 assert.match(db.queries[0].sql,/claim_until>clock_timestamp\(\)/);
 assert.match(db.queries[0].sql,/remote_id/);
 assert.equal(await quarantineExpiredPublicationClaims(db),0);
 assert.match(db.queries[1].sql,/state='needs_review'/);
});
