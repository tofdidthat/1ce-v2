import test from 'node:test';
import assert from 'node:assert/strict';
import {processInstagramDataDeletionOnce,serveInstagramDataDeletionStatus,deletionCodeHash} from '../dist/instagram-data-deletion.js';

const job='11111111-1111-4111-8111-111111111111';
const key=`publishing/users/42/${job}/19/${'a'.repeat(64)}.mp4`;
const artifact={object_key:key,user_id:42,job_id:job,target_id:'19',shared:false};
function fixture(keys=[]){
 const calls=[],deleted=[];
 const client={async query(sql,args){calls.push({sql,args});
  if(sql.startsWith('SELECT request_hash,owners'))return{rowCount:1,rows:[{request_hash:'b'.repeat(64),owners:[42]}]};
  if(sql.startsWith('SELECT pg_try_advisory'))return{rowCount:1,rows:[{locked:true}]};
  if(sql.startsWith('WITH candidates AS'))return{rowCount:keys.length,rows:keys};
  return{rowCount:1,rows:[]};},release(){}};
 return{calls,deleted,db:{connect:async()=>client,query:client.query},storage:{bucket:'synthetic-only',s3:{async send(command){deleted.push(command.input.Key);return{}}}}};
}
test('temporary object cleanup is bounded and never reports completion in the same batch',async()=>{
 const f=fixture([artifact]);assert.equal(await processInstagramDataDeletionOnce(f.db,f.storage),true);
 assert.deepEqual(f.deleted,[key]);assert.equal(f.calls.at(-1).sql,'COMMIT');
 assert.equal(f.calls.some(call=>call.sql.includes('completed_at=clock_timestamp()')),false);
});
test('R2 errors roll back progress so a retry cannot falsely acknowledge deletion',async()=>{
 const f=fixture([artifact]);f.storage.s3.send=async()=>{throw Error('Synthetic R2 unavailable')};
 await assert.rejects(processInstagramDataDeletionOnce(f.db,f.storage),/Synthetic R2/);
 assert.ok(f.calls.some(call=>call.sql==='ROLLBACK'));assert.equal(f.calls.some(call=>call.sql.startsWith('DELETE')),false);
 assert.match(f.calls.at(-1).sql,/not_before=clock_timestamp\(\)\+interval '1 minute'/,'Backoff lets other owners progress');
});
test('missing storage, original keys, cross-owner keys and shared YouTube artifacts fail closed',async()=>{
 for(const [row,available] of [[artifact,false],[{...artifact,object_key:'users/42/assets/audio/original.mp3'},true],
  [{...artifact,object_key:key.replace('/42/','/43/')},true],[{...artifact,shared:true},true]]){
  const f=fixture([row]);await assert.rejects(processInstagramDataDeletionOnce(f.db,available?f.storage:null),/unavailable or unsafe/);
  assert.deepEqual(f.deleted,[]);assert.ok(f.calls.some(call=>call.sql==='ROLLBACK'));
 }
});
test('metadata completion clears owner links and only addresses Instagram integration tables',async()=>{
 const f=fixture();await processInstagramDataDeletionOnce(f.db,null);
 assert.ok(f.calls.some(call=>call.sql.includes("SET owners='{}'::integer[],completed_at=clock_timestamp()")));
 assert.equal(f.calls.some(call=>/DELETE FROM (account_users|library_|v2_youtube_)/.test(call.sql)),false);
 assert.equal(f.calls.at(-1).sql,'COMMIT');
});
test('opaque status reports completed only after both local and legacy cleanup, without identity data',async()=>{
 for(const [completed,legacy,expected] of [[false,true,'pending'],[true,false,'pending'],[true,true,'completed']]){
  const calls=[],db={async query(sql,args){calls.push({sql,args});return{rowCount:1,rows:[{completed_at:completed?'synthetic-date':null,scope_completed:legacy,user_id:42}]}}};
  const res={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=body}};
  await serveInstagramDataDeletionStatus({method:'GET'},res,new URL('https://web.invalid/api/instagram/data-deletion-status?code='+'c'.repeat(32)),db);
  assert.equal(res.status,200);assert.deepEqual(JSON.parse(res.body),{status:expected});
  assert.equal(calls[0].args[0],deletionCodeHash('c'.repeat(32)));assert.equal(res.headers['Cache-Control'],'no-store');
 }
});
test('invalid or repeated status capabilities are rejected before querying',async()=>{
 const db={async query(){throw Error('Must not query')}},res={writeHead(status){this.status=status},end(){}};
 for(const query of ['code=bad','code='+'c'.repeat(32)+'&code='+'c'.repeat(32)]){
  await serveInstagramDataDeletionStatus({method:'GET'},res,new URL('https://web.invalid/status?'+query),db);assert.equal(res.status,404);
 }
});
