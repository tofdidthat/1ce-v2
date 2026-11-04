import test from 'node:test';
import assert from 'node:assert/strict';
import {auditVerifiedOrphans,isS2VerifiedKey,validAuditPrefix} from '../dist/orphan-audit.js';

const now=new Date('2026-11-03T12:00:00Z');
const uuid='123e4567-e89b-42d3-a456-426614174000';
const key=(user,kind,ext)=>'users/'+user+'/assets/'+kind+'/verified/'+uuid+'.'+ext;
const old=new Date('2026-10-27T12:00:00Z');
const young=new Date('2026-11-03T11:00:00Z');
const obj=(Key,LastModified=old,Size=123)=>({Key,LastModified,Size});

test('only S2 verified path is considered, excluding staging, old media and kind/extension mismatches',()=>{
 for(const x of [key(7,'audio','mp3'),key(7,'cover','png'),key(7,'stems','zip')])
  assert.equal(isS2VerifiedKey(x),true);
 for(const x of [
  'staging/'+key(7,'audio','mp3'),
  'users/7/assets/audio/ready/'+uuid+'.mp3',
  key(7,'audio','zip'),key(7,'cover','mp3'),
  key(0,'audio','mp3'),'users/7/assets/audio/verified/not-uuid.mp3'
 ])assert.equal(isS2VerifiedKey(x),false,x);
 assert.equal(validAuditPrefix('users/'),true);
 assert.equal(validAuditPrefix('users/7/'),true);
 for(const x of ['', 'staging/', 'users/../','users/0/','users/7/assets/'])
  assert.equal(validAuditPrefix(x),false,x);
});

test('an older referenced READY object remains protected, only older unreferenced objects are candidates',async()=>{
 const owned=key(1,'audio','mp3'),orphan=key(2,'cover','png'),recent=key(3,'stems','zip');
 let checked;
 const report=await auditVerifiedOrphans({
  now,
  listPage:async()=>({Contents:[obj(owned),obj(orphan,old,51),obj(recent,young),
   obj('users/4/anything'),obj('staging/users/1/file.mp3')],IsTruncated:false}),
  findReferences:async keys=>{checked=keys;return[owned];}
 });
 assert.deepEqual(checked,[owned,orphan]);
 assert.equal(report.complete,true);
 assert.equal(report.status,'suspected-orphans');
 assert.equal(report.suspectedOrphans,1);
 assert.equal(report.suspectedBytes,51);
 assert.equal(report.referenced,1);
 assert.equal(report.notOldEnough,1);
 assert.equal(report.sampleFingerprints.length,1);
 assert.equal(JSON.stringify(report).includes(orphan),false);
 assert.equal(report.readOnly,true);
});

test('truncated R2 pagination remains incomplete and can never be reported as clean',async()=>{
 const report=await auditVerifiedOrphans({
  now,maxPages:1,
  listPage:async()=>({Contents:[obj(key(5,'audio','wav'))],
   IsTruncated:true,NextContinuationToken:'more'}),
  findReferences:async keys=>keys
 });
 assert.equal(report.complete,false);
 assert.equal(report.status,'incomplete');
 assert.equal(report.suspectedOrphans,0);
 assert.equal(report.pages,1);
});

test('R2 listing follows continuation tokens and supports a single-account read-only scope',async()=>{
 const seen=[];
 const report=await auditVerifiedOrphans({
  now,prefix:'users/7/',
  listPage:async({prefix,continuationToken})=>{
   seen.push([prefix,continuationToken]);
   return continuationToken?
    {Contents:[obj(key(7,'cover','webp'))],IsTruncated:false}:
    {Contents:[obj(key(7,'audio','wav'))],IsTruncated:true,NextContinuationToken:'next'};
  },
  findReferences:async keys=>keys
 });
 assert.equal(report.complete,true);
 assert.equal(report.referenced,2);
 assert.deepEqual(seen,[['users/7/',undefined],['users/7/','next']]);
});

test('missing timestamp or size never produces a false clean result',async()=>{
 const report=await auditVerifiedOrphans({
  now,
  listPage:async()=>({Contents:[{Key:key(5,'audio','mp3'),Size:32}],
   IsTruncated:false}),
  findReferences:async()=>[]
 });
 assert.equal(report.missingMetadata,1);
 assert.equal(report.complete,false);
 assert.equal(report.status,'incomplete');
});

test('read errors, malformed listing and pagination failures stop the audit',async()=>{
 await assert.rejects(()=>auditVerifiedOrphans({
  now,listPage:async()=>({Contents:[obj(key(6,'cover','jpg'))]}),
  findReferences:async()=>{throw new Error('database unavailable');}
 }),/database unavailable/);
 await assert.rejects(()=>auditVerifiedOrphans({
  now,listPage:async()=>({Contents:[],IsTruncated:true}),
  findReferences:async()=>[]
 }),/pagination failed/);
 await assert.rejects(()=>auditVerifiedOrphans({
  now,minAgeHours:1,listPage:async()=>({Contents:[]}),findReferences:async()=>[]
 }),/at least 72 hours/);
});
