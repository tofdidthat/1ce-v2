import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {handleLibraryFiles} from '../src/library-files.js';

const checksum=bytes=>createHash('sha256').update(bytes).digest('hex');
const mp3Frame=()=>{
 const frame=Buffer.alloc(417,0);
 Buffer.from([0xff,0xfb,0x90,0x64]).copy(frame,0); // MPEG-1 Layer III, 128k/44.1k
 return frame;
};
const sample=Buffer.concat([
 Buffer.from([0x49,0x44,0x33,0x04,0,0,0,0,0,0]),mp3Frame(),mp3Frame()
]);
const uploaded=(bytes=sample)=>({kind:'audio',name:'original.mp3',contentType:'audio/mpeg',size:bytes.length,sha256:checksum(bytes)});

function setup(){
 const files=new Map(),objects=new Map(),queries=[],commands=[],signed=[],rates=new Map(),planBytes=new Map();
 let onCopy=()=>{},onHead=()=>{};
 let nextId=100,forceUniqueCollision=false;
 const pool={async query(sql,args=[]){
  queries.push({sql,args});
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SELECT pg_advisory_xact_lock'))return {rows:[],rowCount:0};
  if(sql.startsWith('INSERT INTO v2_api_rate_limits')){
   const key=args[0]+':'+args[1],hits=(rates.get(key)||0)+1;
   rates.set(key,hits);return {rows:[{hits}],rowCount:1};
  }
  if(sql.startsWith('SELECT storage_limit_bytes')){
   return {rows:[{storage_limit_bytes:String(planBytes.get(args[0])??10*1024*1024*1024)}],rowCount:1};
  }
  if(sql.startsWith('SELECT\n    count(*) FILTER')){
   const owned=[...files.values()].filter(f=>f.user_id===args[0]);
   const pending=owned.filter(f=>f.status==='pending'&&f.pendingValid!==false);
   const reserved=owned.filter(f=>f.status==='ready'||f.status==='pending'&&f.pendingValid!==false).reduce((sum,f)=>sum+f.byte_size,0);
   return {rows:[{pending_count:pending.length,reserved_bytes:String(reserved)}],rowCount:1};
  }
  if(sql.startsWith("SELECT created_at>now()-interval '30 minutes'")){
   const file=files.get(Number(args[0]));
   return {rows:file&&file.user_id===args[1]?[{valid:file.pendingValid!==false}]:[],rowCount:file?1:0};
  }
  if(sql.startsWith('SELECT object_key,status FROM library_files')){
   const file=files.get(Number(args[0]));return {rows:file?[{object_key:file.object_key,status:file.status}]:[],rowCount:file?1:0};
  }
  if(sql.startsWith('SELECT id,status FROM library_files')){
   const file=files.get(Number(args[0]));return {rows:file?[{id:file.id,status:file.status}]:[],rowCount:file?1:0};
  }
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
  if(sql.startsWith("UPDATE library_files SET object_key=$3,status='ready'")){
   if(forceUniqueCollision){const err=new Error('duplicate ready sha');err.code='23505';throw err;}
   const file=files.get(Number(args[0]));
   // Simulate the real DB unique constraint on READY owner/kind/SHA,
   // including when two completions overlap in independent handlers.
   if(file&&[...files.values()].some(other=>other.id!==file.id&&
    other.user_id===file.user_id&&other.kind===file.kind&&
    other.sha256===file.sha256&&other.status==='ready')){
    const err=new Error('duplicate ready sha');err.code='23505';throw err;
   }
   const updated=file&&file.user_id===args[1]&&file.status==='pending';
   if(updated){file.status='ready';file.object_key=args[2];}
   return {rowCount:updated?1:0,rows:[]};
  }
  if(sql.startsWith("DELETE FROM library_files WHERE id=$1 AND user_id=$2 AND status='pending'")){
   const file=files.get(Number(args[0]));
   if(file&&file.user_id===args[1]&&file.status==='pending')files.delete(file.id);
   return {rowCount:1,rows:[]};
  }
  throw new Error('Unexpected query: '+sql);
 },async connect(){return {query:(...args)=>this.query(...args),release(){}};}};
 const s3={async send(command){
  commands.push(command);
  const key=command.input.Key, object=objects.get(key);
  if(command.constructor.name==='HeadObjectCommand'){
   if(!object){const err=new Error('Not found');err.name='NotFound';throw err;}
   const head={ContentLength:object.bytes.length,ContentType:object.type,ETag:'"'+checksum(object.bytes)+'"'};
    onHead(key,objects,head);return head;
  }
  if(command.constructor.name==='GetObjectCommand'){
   if(!object){const err=new Error('Not found');err.name='NotFound';throw err;}
   const range=command.input.Range;
   if(range){
    const m=/^bytes=(\d+)-(\d+)$/.exec(range);if(!m)throw Error('Invalid mock range');
    const start=Number(m[1]),end=Number(m[2]),bytes=object.bytes.subarray(start,end+1);
    return {Body:Readable.from([bytes]),ContentLength:bytes.length,ContentRange:'bytes '+start+'-'+end+'/'+object.bytes.length};
   }
   return {Body:Readable.from([object.streamBytes||object.bytes]),ContentLength:object.bytes.length};
  }
  if(command.constructor.name==='CopyObjectCommand'){
    const source=command.input.CopySource.split('/').slice(1).join('/'),src=objects.get(source);
    if(!src){const err=Error('Not found');err.name='NotFound';throw err;}
    if(command.input.CopySourceIfMatch&&command.input.CopySourceIfMatch!=='"'+checksum(src.bytes)+'"'){
     const err=Error('Source changed');err.$metadata={httpStatusCode:412};throw err;
    }
    objects.set(key,{bytes:Buffer.from(src.bytes),type:src.type});onCopy(source,key,objects);
    return {};
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
  const req=Readable.from(body===undefined?[]:[Buffer.from(typeof body==='string'?body:JSON.stringify(body))]);
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
  onCopy(fn){onCopy=fn;},onHead(fn){onHead=fn;},rates,planBytes,
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
 assert.ok(file.object_key.startsWith('staging/users/42/assets/audio/'));
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

test('complete resolves a concurrent same-owner ready duplicate and removes its promoted copy',async()=>{
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

test('init malformed and excessive JSON is rejected without a DB write or signed URL',async()=>{
 const h=setup();
 for(const raw of ['{"kind":', 'x'.repeat(8200)]){
  const response=await h.invoke('/api/library/files/init',raw);
  assert.equal(response.status,400);
 }
 assert.equal(h.files.size,0);
 assert.equal(h.signed.length,0);
 assert.equal(h.queries.length,0);
});

test('parallel same-owner uploads with the same SHA converge to one ready asset',async()=>{
 const h=setup(),body=uploaded();
 // Independent inits are allowed to create distinct pending objects. The
 // completion constraint and dedup must retain only one approved reference.
 const [a,b]=await Promise.all([
  h.invoke('/api/library/files/init',body),
  h.invoke('/api/library/files/init',body)
 ]);
 assert.equal(a.status,200);assert.equal(b.status,200);
 assert.notEqual(a.body.id,b.body.id);
 const pendingA=h.files.get(a.body.id),pendingB=h.files.get(b.body.id);
 h.put(pendingA);h.put(pendingB);
 const [resultA,resultB]=await Promise.all([
  h.invoke('/api/library/files/'+a.body.id+'/complete'),
  h.invoke('/api/library/files/'+b.body.id+'/complete')
 ]);
 assert.deepEqual([resultA.status,resultB.status],[200,200]);
 const resultIds=[resultA.body.id,resultB.body.id];
 assert.equal(resultIds[0],resultIds[1]);
 assert.equal([resultA.body.reused===true,resultB.body.reused===true].filter(Boolean).length,1);
 const ready=[...h.files.values()].filter(file=>file.status==='ready');
 assert.equal(ready.length,1);
 assert.equal(h.objects.size,1);
 assert.equal(h.objects.has(ready[0].object_key),true);
 assert.equal(h.files.has(ready[0].id),true);
});

test('invalid complete IDs and failed uploads do not expose other users assets',async()=>{
 const h=setup();
 assert.equal((await h.invoke('/api/library/files/abc/complete')).status,404);
 assert.equal((await h.invoke('/api/library/files/77777/complete')).status,404);
 const start=await h.invoke('/api/library/files/init',uploaded());
 assert.equal(start.status,200);
 const before=h.commands.length;
 assert.equal((await h.invoke('/api/library/files/'+start.body.id+'/complete',undefined,{id:99})).status,404);
 assert.equal(h.commands.length,before);
 assert.equal(h.files.get(start.body.id).status,'pending');
});

// Deliberately unresolved P0 controls, tracked as TODO rather than false
// positive tests. These need a separate behavior-changing security batch.



test('well-formed ID3 tag plus arbitrary non-audio payload fails closed',async()=>{
 const h=setup(),bytes=Buffer.concat([sample.subarray(0,10),Buffer.alloc(sample.length-10,0x61)]);
 const start=await h.invoke('/api/library/files/init',uploaded(bytes));
 const file=h.files.get(start.body.id);h.put(file,bytes);
 const done=await h.invoke('/api/library/files/'+file.id+'/complete');
 assert.equal(done.status,422);
 assert.match(done.body.error,/MP3 first audio frame/);
 assert.equal(file.status,'failed');
 assert.equal(h.objects.size,0);
});

test('spoofed MP3 bytes with a matching declared SHA never become READY',async()=>{
 const h=setup(),bytes=Buffer.alloc(sample.length,0x61);
 const start=await h.invoke('/api/library/files/init',uploaded(bytes));
 assert.equal(start.status,200);
 const file=h.files.get(start.body.id);h.put(file,bytes);
 const response=await h.invoke('/api/library/files/'+file.id+'/complete');
 assert.equal(response.status,422);
 assert.match(response.body.error,/MP3 signature/);
 assert.equal(file.status,'failed');
 assert.equal(h.objects.size,0);
});

test('signed PUT can overwrite staging after copy but cannot modify immutable READY media',async()=>{
 const h=setup(),start=await h.invoke('/api/library/files/init',uploaded());
 const file=h.files.get(start.body.id),staging=file.object_key;
 h.put(file);
 h.onCopy((source,key,objects)=>{
  assert.equal(source,staging);
  objects.set(source,{bytes:Buffer.alloc(sample.length,0x42),type:'audio/mpeg'});
 });
 const done=await h.invoke('/api/library/files/'+file.id+'/complete');
 assert.equal(done.status,200);
 assert.notEqual(file.object_key,staging);
 assert.match(file.object_key,/\/verified\//);
 assert.equal(h.objects.get(file.object_key).bytes.equals(sample),true);
 // A leaked still-valid PUT only recreates disposable staging.
 h.objects.set(staging,{bytes:Buffer.alloc(sample.length,0x43),type:'audio/mpeg'});
 assert.equal(h.objects.get(file.object_key).bytes.equals(sample),true);
});

test('R2 stream exceeding declared byte size is rejected without buffering it into READY',async()=>{
 const h=setup(),start=await h.invoke('/api/library/files/init',uploaded());
 const file=h.files.get(start.body.id);h.put(file);
 h.onCopy((source,key,objects)=>{
  objects.get(key).streamBytes=Buffer.concat([sample,Buffer.from([0])]);
 });
 const response=await h.invoke('/api/library/files/'+file.id+'/complete');
 assert.equal(response.status,422);
 assert.match(response.body.error,/more bytes/);
 assert.equal(file.status,'failed');
 assert.equal(h.objects.size,0);
});

test('quota is owner-scoped and prevents the eleventh concurrent pending upload',async()=>{
 const h=setup();
 for(let i=0;i<10;i++){
  const bytes=Buffer.from(sample);bytes[bytes.length-1]=i;
  assert.equal((await h.invoke('/api/library/files/init',uploaded(bytes))).status,200);
 }
 assert.equal((await h.invoke('/api/library/files/init',uploaded())).status,429);
 assert.equal((await h.invoke('/api/library/files/init',uploaded(),{id:99})).status,200);
 assert.equal(h.files.size,11);
});

test('expired pending reservations cannot become READY',async()=>{
 const h=setup(),start=await h.invoke('/api/library/files/init',uploaded());
 const file=h.files.get(start.body.id);file.pendingValid=false;h.put(file);
 const response=await h.invoke('/api/library/files/'+file.id+'/complete');
 assert.equal(response.status,410);
 assert.equal(file.status,'pending');
 assert.equal(h.commands.some(c=>c.constructor.name==='CopyObjectCommand'),false);
});


test('shared upload init throttle rejects the 241st request without signing',async()=>{
 const h=setup(),body=uploaded();
 for(let i=0;i<240;i++)await h.invoke('/api/library/files/init',body);
 const before=h.signed.length;
 const denied=await h.invoke('/api/library/files/init',body);
 assert.equal(denied.status,429);
 assert.equal(denied.body.error,'Upload rate limit reached');
 assert.equal(h.signed.length,before);
});

test('shared completion throttle caps repeated R2 checks per owner',async()=>{
 const h=setup(),start=await h.invoke('/api/library/files/init',uploaded());
 for(let i=0;i<360;i++)
  assert.equal((await h.invoke('/api/library/files/'+start.body.id+'/complete')).status,409);
 const before=h.commands.length;
 const denied=await h.invoke('/api/library/files/'+start.body.id+'/complete');
 assert.equal(denied.status,429);
 assert.equal(h.commands.length,before);
});

test('per-account stored byte quota includes existing READY assets',async()=>{
 const h=setup(),ready=uploaded();
 h.addReady({...ready,sha256:checksum(Buffer.from('different existing asset')),size:10*1024*1024*1024});
 const denied=await h.invoke('/api/library/files/init',ready);
 assert.equal(denied.status,429);
 assert.match(denied.body.error,/quota/i);
});


test('conditional CopyObject rejects staging replaced between HEAD and promotion',async()=>{
 const h=setup(),start=await h.invoke('/api/library/files/init',uploaded());
 const file=h.files.get(start.body.id);h.put(file);
 h.onHead((key,objects)=>{
  const changed=Buffer.from(sample);changed[changed.length-1]^=0x01;
  objects.set(key,{bytes:changed,type:'audio/mpeg'});
 });
 const response=await h.invoke('/api/library/files/'+file.id+'/complete');
 assert.equal(response.status,409);
 assert.match(response.body.error,/changed during verification/);
 assert.equal(file.status,'pending');
 assert.equal(h.objects.has(file.object_key),true);
 assert.equal([...h.objects.keys()].some(k=>k.includes('/verified/')),false);
});


test('R2 HEAD without ETag fails closed before any server-side copy',async()=>{
 const h=setup(),start=await h.invoke('/api/library/files/init',uploaded());
 const file=h.files.get(start.body.id);h.put(file);
 h.onHead((key,objects,head)=>{delete head.ETag;});
 const response=await h.invoke('/api/library/files/'+file.id+'/complete');
 assert.equal(response.status,503);
 assert.match(response.body.error,/verification unavailable/i);
 assert.equal(file.status,'pending');
 assert.equal(h.commands.some(c=>c.constructor.name==='CopyObjectCommand'),false);
 assert.equal([...h.objects.keys()].some(k=>k.includes('/verified/')),false);
});


test('two simultaneous completions of the same file leave one READY R2 key',async()=>{
 const h=setup(),start=await h.invoke('/api/library/files/init',uploaded());
 const file=h.files.get(start.body.id);h.put(file);
 const [a,b]=await Promise.all([
  h.invoke('/api/library/files/'+file.id+'/complete'),
  h.invoke('/api/library/files/'+file.id+'/complete')
 ]);
 assert.equal([a.status,b.status].includes(200),true);
 assert.equal([a.status,b.status].every(status=>status===200||status===409),true);
 assert.equal(file.status,'ready');
 const finals=[...h.objects.keys()].filter(key=>key.includes('/verified/'));
 assert.deepEqual(finals,[file.object_key]);
 assert.equal(h.objects.get(file.object_key).bytes.equals(sample),true);
});


test('per-account storage plan quota changes without modifying other account entitlements',async()=>{
 const h=setup(),body=uploaded();
 h.planBytes.set(42,body.size-1);
 assert.equal((await h.invoke('/api/library/files/init',body)).status,429);
 h.planBytes.set(42,body.size*2);
 assert.equal((await h.invoke('/api/library/files/init',body)).status,200);
 h.planBytes.set(99,body.size-1);
 assert.equal((await h.invoke('/api/library/files/init',body,{id:99})).status,429);
 assert.equal(h.files.size,1);
});
