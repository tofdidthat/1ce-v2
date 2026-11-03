import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {handleLibraryFiles} from '../src/library-files.js';

const checksum=bytes=>createHash('sha256').update(bytes).digest('hex');
const sample=Buffer.from([0x49,0x44,0x33,0x04,0,0,0,0,0,0,0xff,0xfb,0x90,0x64]);
const uploaded=(bytes=sample)=>({kind:'audio',name:'original.mp3',contentType:'audio/mpeg',size:bytes.length,sha256:checksum(bytes)});

function setup(){
 const files=new Map(),objects=new Map(),queries=[],commands=[],signed=[];
 let nextId=100,forceUniqueCollision=false;
 const pool={async query(sql,args=[]){
  queries.push({sql,args});
  if(sql.startsWith('SELECT id FROM library_files WHERE user_id=$1 AND kind=$2 AND sha256=$3')){
   const row=[...files.values()].find(file=>file.user_id===args[0]&&file.kind===args[1]&&file.sha256===args[2]&&file.status==='ready');
   return {rows:row?[{id:row.id}]:[],rowCount:row?1:0};
  }
  if(sql.startsWith('INSERT INTO library_files(')){
   const [user_id,kind,object_key,original_name,content_type,byte_size,sha256]=args;
   const file={id:nextId++,user_id,kind,object_key,original_name,content_type,byte_size,sha256,status:'pending'};
   files.set(file.id,file);
   return {rows:[{id:file.id}],rowCount:1};
  }
  if(sql.startsWith('SELECT id,kind,sha256,object_key,content_type,byte_size,status FROM library_files')){
   const file=files.get(Number(args[0]));
   const rows=file&&file.user_id===args[1]?[file]:[];
   return {rows,rowCount:rows.length};
  }
  if(sql.startsWith("UPDATE library_files SET status='failed'")){
   const file=files.get(Number(args[0]));
   if(file&&file.user_id===args[1])file.status='failed';
   return {rowCount:file?1:0,rows:[]};
  }
  if(sql.startsWith("UPDATE library_files SET status='ready'")){
   if(forceUniqueCollision){const err=new Error('duplicate ready sha');err.code='23505';throw err;}
   const file=files.get(Number(args[0]));
   if(file&&file.user_id===args[1]&&file.status==='pending')file.status='ready';
   return {rowCount:file?1:0,rows:[]};
  }
  if(sql.startsWith("DELETE FROM library_files WHERE id=$1 AND user_id=$2 AND status='pending'")){
   const file=files.get(Number(args[0]));
   if(file&&file.user_id===args[1]&&file.status==='pending')files.delete(file.id);
   return {rowCount:1,rows:[]};
  }
  throw new Error('Unexpected query: '+sql);
 }};
 const s3={async send(command){
  commands.push(command);
  const key=command.input.Key, object=objects.get(key);
  if(command.constructor.name==='HeadObjectCommand'){
   if(!object){const err=new Error('Not found');err.name='NotFound';throw err;}
   return {ContentLength:object.bytes.length,ContentType:object.type};
  }
  if(command.constructor.name==='GetObjectCommand'){
   if(!object){const err=new Error('Not found');err.name='NotFound';throw err;}
   return {Body:Readable.from([object.bytes])};
  }
  if(command.constructor.name==='DeleteObjectCommand'){objects.delete(key);return {};}
  throw new Error('Unexpected storage command: '+command.constructor.name);
 }};
 const options={
  storageFactory:()=>({s3,bucket:'isolated-v2-test'}),
  signUrl:async (signer,command,settings)=>{
   assert.equal(signer,s3);
   signed.push({input:command.input,settings});
   return 'https://r2-signature.invalid/upload';
  }
 };
 async function invoke(path,body,user={id:42}){
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
  req.method='POST';req.headers={};
  const res={status:0,headers:{},body:null,
   writeHead(status,headers){this.status=status;this.headers=headers;},
   end(raw){this.body=raw?JSON.parse(raw):null;}};
  const handled=await handleLibraryFiles(req,res,path,pool,async()=>user,options);
  assert.equal(handled,true);
  return res;
 }
 const put=(file,bytes=sample,type=file.content_type)=>objects.set(file.object_key,{bytes,type});
 const addReady=(data,userId=42)=>{
  const file={id:nextId++,user_id:userId,kind:data.kind,sha256:data.sha256,object_key:'users/'+userId+'/assets/'+data.kind+'/ready',content_type:data.contentType,byte_size:data.size,status:'ready'};
  files.set(file.id,file);return file;
 };
 return {files,objects,queries,commands,signed,invoke,put,addReady,
  setUniqueCollision(value){forceUniqueCollision=value},
  setSigningFailure(){options.signUrl=async()=>{throw Error('signer unavailable');}}
 };
}

test('upload init/complete require authentication and never allocate files or storage for anonymous users',async()=>{
 const h=setup();
 assert.equal((await h.invoke('/api/library/files/init',uploaded(),null)).status,401);
 assert.equal((await h.invoke('/api/library/files/100/complete',undefined,null)).status,401);
 assert.equal(h.files.size,0);
 assert.equal(h.commands.length,0);
 assert.equal(h.signed.length,0);
});

test('upload init rejects invalid metadata, hashes, MIME/extensions and file size before DB or signing',async()=>{
 const h=setup();
 const invalid=[
  {...uploaded(),kind:'script'},
  {...uploaded(),name:'../../original.mp3'},
  {...uploaded(),name:'track.zip'},
  {...uploaded(),contentType:'application/zip'},
  {...uploaded(),sha256:'deadbeef'},
  {...uploaded(),size:0},
  {...uploaded(),size:150*1024*1024+1},
  {...uploaded(),size:1.5},
  {...uploaded(),name:''}
 ];
 for(const body of invalid)assert.equal((await h.invoke('/api/library/files/init',body)).status,400,JSON.stringify(body));
 assert.equal(h.queries.length,0);
 assert.equal(h.signed.length,0);
 assert.equal(h.files.size,0);
});

test('valid init scopes object key to owner, signs 300-second URL and only deduplicates ready same-owner kind/hash',async()=>{
 const h=setup(),body=uploaded();
 const first=await h.invoke('/api/library/files/init',body);
 assert.equal(first.status,200);assert.equal(first.body.expiresIn,300);
 const file=h.files.get(first.body.id);
 assert.ok(file.object_key.startsWith('users/42/assets/audio/'));
 assert.ok(file.object_key.endsWith('.mp3'));
 assert.equal(file.status,'pending');
 assert.equal(h.signed[0].settings.expiresIn,300);
 assert.equal(h.signed[0].input.Key,file.object_key);
 assert.equal(h.signed[0].input.ContentLength,body.size);
 assert.equal(h.signed[0].input.ContentType,body.contentType);
 // Pending uploads are not deduplicated, and another account cannot reuse this row.
 assert.equal((await h.invoke('/api/library/files/init',body)).body.reused,undefined);
 h.addReady(body,99);
 assert.equal((await h.invoke('/api/library/files/init',body)).body.reused,undefined);
 const ready=h.addReady(body);
 const sameOwner=await h.invoke('/api/library/files/init',body);
 assert.equal(sameOwner.status,200);
 assert.deepEqual(sameOwner.body,{id:ready.id,reused:true});
});

test('a failed R2 presign removes the pending metadata row instead of leaving a dangling upload',async()=>{
 const h=setup();h.setSigningFailure();
 await assert.rejects(()=>h.invoke('/api/library/files/init',uploaded()),/signer unavailable/);
 assert.equal(h.files.size,0);
 assert.equal(h.queries.some(call=>call.sql.startsWith("DELETE FROM library_files WHERE id=$1 AND user_id=$2 AND status='pending'")),true);
});

test('complete never reads another owner file, accepts retries of ready, and reports missing upload',async()=>{
 const h=setup(),start=await h.invoke('/api/library/files/init',uploaded());
 assert.equal((await h.invoke('/api/library/files/'+start.body.id+'/complete',undefined,{id:99})).status,404);
 assert.equal((await h.invoke('/api/library/files/'+start.body.id+'/complete')).status,409);
 assert.equal(h.files.get(start.body.id).status,'pending');
 h.put(h.files.get(start.body.id));
 const first=await h.invoke('/api/library/files/'+start.body.id+'/complete');
 assert.equal(first.status,200);
 assert.equal(h.files.get(start.body.id).status,'ready');
 const reads=h.commands.length;
 const retry=await h.invoke('/api/library/files/'+start.body.id+'/complete');
 assert.equal(retry.status,200);
 assert.equal(retry.body.id,start.body.id);
 assert.equal(h.commands.length,reads);
});

test('complete rejects mismatched R2 content metadata and SHA, deletes unsafe object and marks DB failed',async()=>{
 const h=setup(),badMeta=await h.invoke('/api/library/files/init',uploaded());
 h.put(h.files.get(badMeta.body.id),sample,'image/png');
 let res=await h.invoke('/api/library/files/'+badMeta.body.id+'/complete');
 assert.equal(res.status,422);assert.equal(h.files.get(badMeta.body.id).status,'failed');
 assert.equal(h.objects.size,0);
 assert.equal((await h.invoke('/api/library/files/'+badMeta.body.id+'/complete')).status,409);
 const badHash=await h.invoke('/api/library/files/init',uploaded());
 h.put(h.files.get(badHash.body.id),Buffer.from('tampered'));
 res=await h.invoke('/api/library/files/'+badHash.body.id+'/complete');
 // The fake head sees a length mismatch first; use equal-size tampering to
 // verify the SHA path separately.
 assert.equal(res.status,422);
 const sameSize=await h.invoke('/api/library/files/init',uploaded());
 const bytes=Buffer.from(sample);bytes[bytes.length-1]^=0xff;
 h.put(h.files.get(sameSize.body.id),bytes);
 res=await h.invoke('/api/library/files/'+sameSize.body.id+'/complete');
 assert.equal(res.status,422);
 assert.equal(res.body.error,'File checksum mismatch');
 assert.equal(h.files.get(sameSize.body.id).status,'failed');
 assert.equal(h.objects.size,0);
});

test('complete resolves a concurrent same-owner ready duplicate without copying its R2 object',async()=>{
 const h=setup(),body=uploaded(),start=await h.invoke('/api/library/files/init',body);
 const pending=h.files.get(start.body.id);h.put(pending);
 const ready=h.addReady(body);
 h.setUniqueCollision(true);
 const complete=await h.invoke('/api/library/files/'+pending.id+'/complete');
 assert.equal(complete.status,200);
 assert.equal(complete.body.id,ready.id);
 assert.equal(complete.body.reused,true);
 assert.equal(h.files.has(pending.id),false);
 assert.equal(h.objects.has(pending.object_key),false);
});

// Deliberately unresolved P0 controls, tracked as TODO rather than false
// positive tests. These need a separate behavior-changing security batch.
test.todo('P0: reject spoofed MP3/image/ZIP payloads by parsing real file bytes');
test.todo('P0: prevent post-verification object overwrites while the signed PUT URL is live');
test.todo('P0: enforce bounded R2 verification time and streamed byte count');
