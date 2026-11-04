// Phase 4C: real PostgreSQL + local disposable S3 compatibility integration.
// Never use a production endpoint/bucket; exit before touching storage or DB
// unless executing as a CI job against exact loopback endpoints and DB name.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import pg from 'pg';
import {
 S3Client,CreateBucketCommand,PutObjectCommand,GetObjectCommand,
 HeadObjectCommand,CopyObjectCommand,DeleteObjectCommand
} from '@aws-sdk/client-s3';
import {handleLibraryFiles} from '../dist/library-files.js';

const dbUrl=process.env.S2_TEST_DATABASE_URL;
const endpoint=process.env.S2_TEST_S3_ENDPOINT;
const bucket=process.env.S2_TEST_S3_BUCKET;
const parsed=dbUrl?new URL(dbUrl):null;
if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||
 !parsed||!['localhost','127.0.0.1'].includes(parsed.hostname)||
 !['postgres:','postgresql:'].includes(parsed.protocol)||
 parsed.port!=='5432'||parsed.pathname!=='/onece_s2_ci'||
 endpoint!=='http://127.0.0.1:9000'||bucket!=='onece-s2-ci-only')
 throw Error('Refusing integration test outside isolated CI PostgreSQL and loopback S3');
const s3=new S3Client({
 region:'us-east-1',endpoint,forcePathStyle:true,
 credentials:{accessKeyId:'onece_ci',secretAccessKey:'onece-ci-minio-only'}
});
const pool=new pg.Pool({connectionString:dbUrl,max:12,connectionTimeoutMillis:5000});
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../history/database');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const frame=()=>{
 const bytes=Buffer.alloc(417);
 Buffer.from([0xff,0xfb,0x90,0x64]).copy(bytes);
 return bytes;
};
const original=Buffer.concat([frame(),frame()]);
const distinct=Buffer.from(original);
distinct[99]=0x51;
const unique=Buffer.from(original);
unique[155]=0x62;
const payloadInfo=bytes=>({
 kind:'audio',name:'validation.mp3',contentType:'audio/mpeg',
 size:bytes.length,sha256:digest(bytes)
});
const getBytes=async key=>{
 const obj=await s3.send(new GetObjectCommand({Bucket:bucket,Key:key}));
 const chunks=[];
 for await(const bytes of obj.Body)chunks.push(Buffer.from(bytes));
 return Buffer.concat(chunks);
};
const readRow=async id=>
 (await pool.query('SELECT id,user_id,kind,status,sha256,object_key FROM library_files WHERE id=$1',[id])).rows[0];
async function invoke(route,body,userId,client=s3){
 const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
 req.method='POST';
 req.headers={};
 const res={status:0,headers:{},data:null,
  writeHead(code,headers){this.status=code;this.headers=headers;},
  end(data){this.data=data?JSON.parse(data):null;}
 };
 assert.equal(await handleLibraryFiles(req,res,route,pool,async()=>userId?{id:userId}:null,{
  storageFactory:()=>({s3:client,bucket})
 }),true);
 return res;
}
async function begin(userId,bytes,declared=payloadInfo(bytes)){
 const res=await invoke('/api/library/files/init',declared,userId);
 assert.equal(res.status,200,JSON.stringify(res.data));
 assert.equal(res.data.expiresIn,300);
 assert.match(res.data.uploadUrl,/^http:\/\/127\.0\.0\.1:9000\/onece-s2-ci-only\/staging\//);
 const row=await readRow(res.data.id);
 assert.equal(row.user_id,userId);
 assert.equal(row.status,'pending');
 assert.match(row.object_key,new RegExp('^staging/users/'+userId+'/assets/audio/'));
 const put=await fetch(res.data.uploadUrl,{method:'PUT',
  headers:{'Content-Type':'audio/mpeg'},body:bytes,signal:AbortSignal.timeout(15000)});
 assert.equal(put.status,200,'Presigned local S3 PUT: '+put.status);
 return {id:res.data.id,url:res.data.uploadUrl,staging:row.object_key};
}
const complete=(id,userId,client)=>
 invoke('/api/library/files/'+id+'/complete',undefined,userId,client);

try{
 await s3.send(new CreateBucketCommand({Bucket:bucket}));
 for(const name of [
  '001_auth_initial_schema.sql','003_library_files_r2.sql',
  '004_library_collections.sql','004_public_profiles.sql',
  '005_library_asset_dedup.sql','006_library_standalone_visibility.sql',
  '010_api_rate_limits.sql','011_storage_plans_completion_leases.sql',
  '012_trash_and_r2_delete_outbox.sql'
 ])await pool.query(await readFile(resolve(root,name),'utf8'));
 const a=(await pool.query("INSERT INTO account_users(email) VALUES('s3-owner-a@ci.invalid') RETURNING id")).rows[0].id;
 const b=(await pool.query("INSERT INTO account_users(email) VALUES('s3-owner-b@ci.invalid') RETURNING id")).rows[0].id;

 // 1. Real signed PUT -> HEAD/ETag -> server conditional COPY -> SHA, MP3
 // byte-range validation -> fenced READY -> staging DELETE.
 const first=await begin(a,original);
 assert.equal((await complete(first.id,b)).status,404,'Other account must never complete a file');
 const firstResult=await complete(first.id,a);
 assert.equal(firstResult.status,200,JSON.stringify(firstResult.data));
 const ready=await readRow(first.id);
 assert.equal(ready.status,'ready');
 assert.match(ready.object_key,new RegExp('^users/'+a+'/assets/audio/verified/'));
 assert.deepEqual(await getBytes(ready.object_key),original);
 await assert.rejects(()=>s3.send(new HeadObjectCommand({Bucket:bucket,Key:first.staging})));
 // The original signed PUT remains restricted to staging and cannot mutate READY.
 const overwrite=await fetch(first.url,{method:'PUT',
  headers:{'Content-Type':'audio/mpeg'},body:distinct,signal:AbortSignal.timeout(15000)});
 assert.equal(overwrite.status,200);
 assert.deepEqual(await getBytes(ready.object_key),original);
 await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:first.staging}));
 // Same-owner identical file: reuse one DB reference, no new signing.
 const reused=await invoke('/api/library/files/init',payloadInfo(original),a);
 assert.equal(reused.status,200);
 assert.deepEqual(reused.data,{id:first.id,reused:true});
 const other=await begin(b,original);
 assert.notEqual(other.id,first.id,'Dedup must be owner-scoped');
 assert.equal((await complete(other.id,b)).status,200);

 // 2. Two workers finalize same pending upload; only one READY asset exists.
 const concurrent=await begin(a,distinct);
 const outcomes=await Promise.all([complete(concurrent.id,a),complete(concurrent.id,a)]);
 assert.ok(outcomes.some(x=>x.status===200),JSON.stringify(outcomes));
 assert.ok(outcomes.every(x=>x.status===200||x.status===409),JSON.stringify(outcomes));
 const secondRow=await readRow(concurrent.id);
 assert.equal(secondRow.status,'ready');
 assert.deepEqual(await getBytes(secondRow.object_key),distinct);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM library_files WHERE id=$1 AND status='ready'",[concurrent.id])).rows[0].n,1);

 // 3. Declared SHA never overrides actual data and invalid content is not READY.
 const forged=await begin(a,original,{...payloadInfo(original),sha256:'f'.repeat(64)});
 const invalid=await complete(forged.id,a);
 assert.equal(invalid.status,422,JSON.stringify(invalid.data));
 assert.equal((await readRow(forged.id)).status,'failed');

 // 4. A stale HEAD ETag must reject conditional COPY when a still-live
 // signed staging object changes between HEAD and COPY. No READY promotion.
 const raced=await begin(a,unique);
 let replaced=false;
 const racingS3={
  send:async(command,options)=>{
   if(command instanceof CopyObjectCommand&&!replaced){
    replaced=true;
    await s3.send(new PutObjectCommand({Bucket:bucket,
     Key:raced.staging,Body:original,ContentType:'audio/mpeg'}));
   }
   return s3.send(command,options);
  }
 };
 const stale=await complete(raced.id,a,racingS3);
 assert.equal(replaced,true);
 assert.equal(stale.status,409,JSON.stringify(stale.data));
 assert.equal((await readRow(raced.id)).status,'pending');

 // 5. Owner-scoped beats & packs refer to existing READY rows, not R2 copies.
 const beatOne=await invoke('/api/library/files/beats',{title:'Existing beat',audioFileId:first.id},a);
 const beatTwo=await invoke('/api/library/files/beats',{title:'New pack beat',audioFileId:concurrent.id},a);
 assert.equal(beatOne.status,201);
 assert.equal(beatTwo.status,201);
 const existing=await invoke('/api/library/files/beats',{title:'Reused',audioFileId:first.id},a);
 assert.equal(existing.status,200);
 assert.equal(existing.data.id,beatOne.data.id);
 assert.equal(existing.data.reused,true);
 const denied=await invoke('/api/library/files/beats',{title:'Forbidden',audioFileId:other.id},a);
 assert.equal(denied.status,400);
 const pack=await invoke('/api/library/files/packs',{
  title:'S3 integration pack',beatIds:[beatOne.data.id,beatTwo.data.id],
  newBeatIds:[beatTwo.data.id]
 },a);
 assert.equal(pack.status,201,JSON.stringify(pack.data));
 const membership=await pool.query('SELECT beat_id,position FROM library_pack_beats WHERE pack_id=$1 ORDER BY position',[pack.data.id]);
 assert.deepEqual(membership.rows.map(x=>x.beat_id),[beatOne.data.id,beatTwo.data.id]);
 const visibility=await pool.query('SELECT id,library_visible FROM library_beats WHERE id=ANY($1::uuid[])',[[beatOne.data.id,beatTwo.data.id]]);
 const shown=new Map(visibility.rows.map(x=>[x.id,x.library_visible]));
 assert.equal(shown.get(beatOne.data.id),true);
 assert.equal(shown.get(beatTwo.data.id),false);

 console.log('Phase 4C isolated PostgreSQL + live local S3 PASS: signed PUT, HEAD, conditional COPY, ranges, SHA, dedup, owner isolation, concurrency, immutability, stale ETag, beats and packs');
}finally{
 await pool.end();
 s3.destroy();
}
