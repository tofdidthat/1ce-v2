import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {deletionCodeHash, scheduleInstagramDataDeletion, serveInstagramDataDeletionStatus} from '../dist/instagram-data-deletion.js';

const modulePath=process.argv[2];
assert.ok(modulePath,'Pass the absolute path to the isolated PGlite dist/index.js');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const db=new PGlite(); // In-memory engine, no connection string or persistent data.
const sql=name=>readFile(new URL('../../../history/database/'+name,import.meta.url),'utf8');
const load=await sql('t061_meta_receipt_load.sql');
const code='a'.repeat(32), otherCode='b'.repeat(32);
const hash=deletionCodeHash(code), otherHash=deletionCodeHash(otherCode);
const completed='2026-10-30T12:00:00Z';

async function importBatch(rows,{commit=true}={}){
 await db.exec('BEGIN');
 try{
  await db.exec(`CREATE TEMP TABLE t061_meta_receipt_stage (
   confirmation_hash text NOT NULL CHECK (confirmation_hash ~ '^[0-9a-f]{64}$'),
   completed_at timestamptz
  ) ON COMMIT DROP`);
  for(const row of rows)await db.query('INSERT INTO t061_meta_receipt_stage VALUES($1,$2)',row);
  const result=(await db.exec(load)).at(-1).rows[0];
  await db.exec(commit?'COMMIT':'ROLLBACK');
  return result;
 }catch(error){
  await db.exec('ROLLBACK');
  throw error;
 }
}

async function status(code){
 let status,body;
 await serveInstagramDataDeletionStatus({method:'GET'},{
  writeHead(value){status=value},end(value){body=JSON.parse(value)}
 },new URL('https://example.invalid/privacy?deletion='+code),db,{
  localLegacyReceipts:true,http:async()=>Response.json({status:'not_found'},{status:404}),
 });
 return [status,body];
}

try{
 console.log((await db.query('SELECT version()')).rows[0].version);
 await db.exec('CREATE TABLE account_users (id integer PRIMARY KEY)');
 await db.exec(await sql('020_instagram_meta_compliance.sql'));
 const migration=await sql('024_instagram_meta_retirement.sql');
 await db.exec(migration);
 await db.exec(migration);

 const exported=(await db.query("SELECT encode(sha256(convert_to($1, 'UTF8')), 'hex') AS hash",[code])).rows[0];
 assert.equal(exported.hash,hash);
 const original=[[hash,null],[otherHash,completed]];
 const expected={matched:2,pending:1,completed:1,stale_pending:0};
 assert.deepEqual(await importBatch(original,{commit:false}),expected);
 assert.deepEqual(await status(code),[404,{error:'not_found'}]);
 assert.deepEqual(await importBatch(original),expected);
 assert.deepEqual(await importBatch(original),expected);
 assert.deepEqual(await status(code),[200,{status:'pending'}]);
 assert.deepEqual(await status(otherCode),[200,{status:'completed'}]);

 await assert.rejects(importBatch([]),/Empty batch/);
 await assert.rejects(importBatch([[hash,null],[hash,null]]),/Duplicate confirmation hash/);
 await assert.rejects(importBatch([[hash,completed],[otherHash,'2026-10-31T12:00:00Z']]),/Conflicting verified/);
 await assert.rejects(importBatch([[hash,completed],['invalid',null]]),/check constraint/);
 assert.deepEqual(await status(code),[200,{status:'pending'}]);
 assert.deepEqual(await importBatch([[hash,completed]]),{matched:1,pending:0,completed:1,stale_pending:0});
 assert.deepEqual(await importBatch([[hash,null]]),{matched:1,pending:0,completed:1,stale_pending:1});
 assert.deepEqual(await status(code),[200,{status:'completed'}]);
 const count=(await db.query('SELECT count(*) AS total FROM v2_instagram_legacy_deletion_status')).rows[0];
 assert.equal(count.total,2);

 await db.exec(`CREATE TABLE v2_instagram_data_deletions (request_hash text);
  CREATE TABLE v2_instagram_connections (user_id int, instagram_user_id text);
  CREATE TABLE v2_publication_jobs (user_id int, instagram_generation uuid);
  INSERT INTO v2_publication_jobs VALUES (42,'00000000-0000-0000-0000-000000000001')`);
 assert.equal(await scheduleInstagramDataDeletion(db,'c'.repeat(64),code,'d'.repeat(64),'123'),'unresolved');
 assert.equal((await db.query('SELECT count(*) AS total FROM v2_instagram_data_deletions')).rows[0].total,0);
 console.log('PASS: migration 024, dry run rollback, replay, promotion, conflicts, status and unresolved identity');
}finally{
 await db.close();
}
