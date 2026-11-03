import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {handleTrash,processPendingTrashJobs} from '../src/trash.js';

const owner=42;
const beat='75f80bde-7b6a-4b18-8b1f-4e52eb98f776';
const key='users/42/assets/audio/verified/10000000-0000-4000-8000-000000000011.mp3';

async function invoke({pool,method='GET',path='/api/library/trash',body,identity={id:42},storageFactory}){
 const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
 req.method=method;
 const res={status:0,body:null,writeHead(status){this.status=status;},end(raw){this.body=raw?JSON.parse(raw):null;}};
 const handled=await handleTrash(req,res,path,pool,async()=>identity,{storageFactory});
 assert.equal(handled,true);
 return res;
}
function poolFixture(){
 const calls=[];
 const pool={
  calls,async query(sql,args=[]){
   calls.push({sql,args});
   if(sql.startsWith('SELECT b.id,b.title,b.deleted_at FROM library_beats b'))return {rows:[{id:beat,title:'Test',deleted_at:'2026-11-03T00:00:00Z'}],rowCount:1};
   if(sql.startsWith('SELECT id,title,deleted_at FROM library_packs'))return {rows:[],rowCount:0};
   if(sql.startsWith('SELECT count(*)::int AS pending FROM v2_r2_delete_jobs'))return {rows:[{pending:0}],rowCount:1};
   if(sql.startsWith('SELECT id FROM library_packs WHERE user_id=$1')&&sql.includes('FOR UPDATE'))return {rows:[{id:beat}],rowCount:1};
   if(sql.startsWith('UPDATE library_beats b SET deleted_at=NULL'))return {rows:[{id:beat}],rowCount:1};
   if(sql.startsWith('UPDATE library_packs SET deleted_at=NULL'))return {rows:[{id:beat}],rowCount:1};
   if(sql.startsWith('UPDATE library_beats SET deleted_at=NULL'))return {rowCount:1,rows:[{id:beat}]};
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SELECT pg_advisory_xact_lock'))return {rows:[],rowCount:0};
   throw Error('Unexpected query: '+sql);
  },
  async connect(){return {query:(...args)=>this.query(...args),release(){}};}
 };
 return pool;
}

test('Trash requires authentication and does not disclose another user projects',async()=>{
 const pool=poolFixture();
 assert.equal((await invoke({pool,identity:null})).status,401);
 assert.equal(pool.calls.length,0);
 const res=await invoke({pool});
 assert.equal(res.status,200);
 assert.equal(res.body.items[0].id,beat);
 assert.equal(res.body.items[0].kind,'beat');
 assert.equal(res.body.retentionDays,30);
 assert.equal(pool.calls.every(call=>call.args[0]===owner),true);
});

test('only user-owned deleted project can be restored; no R2 delete on restore',async()=>{
 const pool=poolFixture(),storageFactory=()=>{throw Error('R2 must not be used')};
 const res=await invoke({pool,method:'POST',path:'/api/library/trash/beat/'+beat+'/restore',storageFactory});
 assert.equal(res.status,200);
 assert.equal(res.body.restored,true);
 assert.equal(pool.calls.some(c=>c.sql.includes("deleted_at>=now()-interval '30 days'")),true);
 assert.equal(pool.calls.filter(c=>c.sql.startsWith('UPDATE')).length,1);
});

test('empty requires exact irreversible confirmation before reading storage or mutating DB',async()=>{
 const pool=poolFixture(),storageFactory=()=>{throw Error('Storage must not be called')};
 for(const confirmation of ['', 'DELETE', 'empty trash'])
  assert.equal((await invoke({pool,method:'POST',path:'/api/library/trash/empty',body:{confirmation},storageFactory})).status,400);
 assert.equal(pool.calls.length,0);
});

test('queued R2 objects are deleted only from owner verified path, with durable success status',async()=>{
 const items=[{id:11,object_key:key}];
 const calls=[];
 const pool={async query(sql,args=[]){
  calls.push({sql,args});
  if(sql.startsWith('WITH next AS'))return {rows:items.splice(0,1),rowCount:1};
  if(sql.startsWith('UPDATE v2_r2_delete_jobs SET completed_at'))return {rows:[],rowCount:1};
  if(sql.startsWith('SELECT count(*)::int AS pending'))return {rows:[{pending:0}],rowCount:1};
  throw Error('Unexpected '+sql);
 }};
 const commands=[];
 const s3={async send(command){commands.push(command);return {}}};
 const result=await processPendingTrashJobs(pool,{owner,s3,bucket:'v2-test'});
 assert.equal(result.deletedMedia,1);
 assert.equal(result.pendingMedia,0);
 assert.equal(commands.length,1);
 assert.equal(commands[0].constructor.name,'DeleteObjectCommand');
 assert.equal(commands[0].input.Key,key);
 assert.equal(commands[0].input.Bucket,'v2-test');
 assert.equal(calls.some(x=>x.sql.startsWith('UPDATE v2_r2_delete_jobs SET completed_at')),true);
});

test('unsafe key is not passed to DeleteObject even if a malformed job exists',async()=>{
 const pool={async query(sql){
  if(sql.startsWith('WITH next AS'))return {rows:[{id:5,object_key:'users/99/assets/audio/verified/10000000-0000-4000-8000-000000000011.mp3'}]};
  if(sql.includes("last_error='Unsafe key refused'"))return {rowCount:1};
  if(sql.startsWith('SELECT count(*)::int AS pending'))return {rows:[{pending:1}]};
  throw Error('Unexpected: '+sql);
 }};
 let sent=0;
 const res=await processPendingTrashJobs(pool,{owner,s3:{async send(){sent++}},bucket:'v2'});
 assert.equal(res.failedMedia,1);
 assert.equal(res.pendingMedia,1);
 assert.equal(sent,0);
});

test('transient R2 error preserves a pending job so Empty Trash can retry',async()=>{
 const pool={async query(sql){
  if(sql.startsWith('WITH next AS'))return {rows:[{id:6,object_key:key}]};
  if(sql.includes("last_error='R2 delete failed; retry later'"))return {rowCount:1};
  if(sql.startsWith('SELECT count(*)::int AS pending'))return {rows:[{pending:1}]};
  throw Error('Unexpected: '+sql);
 }};
 const res=await processPendingTrashJobs(pool,{owner,s3:{async send(){throw Error('R2 unavailable')}},bucket:'v2'});
 assert.equal(res.deletedMedia,0);
 assert.equal(res.failedMedia,1);
 assert.equal(res.pendingMedia,1);
});

test('restoring a pack first revives only auto-trashed member beats inside the same owner transaction',async()=>{
 const pool=poolFixture();
 const res=await invoke({pool,method:'POST',path:'/api/library/trash/pack/'+beat+'/restore',
  storageFactory:()=>{throw Error('Restoring a pack must not use R2')}});
 assert.equal(res.status,200);
 assert.equal(res.body.kind,'pack');
 const checks=pool.calls.map(x=>x.sql);
 const eligible=checks.findIndex(x=>x.startsWith('SELECT id FROM library_packs WHERE user_id=$1'));
 const members=checks.findIndex(x=>x.startsWith('UPDATE library_beats b SET deleted_at=NULL'));
 const packRestore=checks.findIndex(x=>x.startsWith('UPDATE library_packs SET deleted_at=NULL'));
 assert.ok(eligible>=0&&members>eligible&&packRestore>members);
 assert.match(checks[members],/source_p.deleted_at=b.deleted_at/);
 assert.match(checks[members],/b.library_visible=FALSE/);
 assert.equal(checks.at(-2),'COMMIT');
});
