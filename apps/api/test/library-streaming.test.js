import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {handleLibraryFiles} from '../dist/library-files.js';

const bytes=Buffer.from('verified-media-bytes');
const contentTypes={audio:'audio/mpeg',stems:'application/zip',cover:'image/png'};

function fixture({user={id:7},owned=true,storageConfigured=true,bodyMode='readable'}={}){
 const dbCalls=[];
 const db={
  query:async(sql,args)=>{
   dbCalls.push({sql,args});
   if(sql.includes('FROM library_files f')){
    const kind=args[2];
    return {rowCount:owned?1:0,rows:owned?[{
     object_key:'users/7/assets/'+kind+'/verified.bin',
     content_type:contentTypes[kind],byte_size:bytes.length
    }]:[]};
   }
   if(sql.includes('FROM library_files WHERE user_id=$1')){
    return {rowCount:0,rows:[]};
   }
   return {rowCount:0,rows:[]};
  }
 };
 const s3Calls=[];
 const s3={send:async(command)=>{
  s3Calls.push(command.input);
  if(bodyMode==='throw')throw Error('R2 unavailable');
  if(bodyMode==='unreadable')return {Body:{}};
  const range=command.input.Range;
  let payload=bytes;
  if(range){
   const match=/^bytes=(\d+)-(\d+)$/.exec(range);
   payload=bytes.subarray(Number(match[1]),Number(match[2])+1);
  }
  if(bodyMode==='interrupt'){
   return {Body:(async function*(){yield payload.subarray(0,1);throw Error('R2 stream interrupted');})()};
  }
  return {Body:Readable.from([payload])};
 }};
 const invoke=async(path,{requestUser=user,range,method='GET'}={})=>{
  const req=Readable.from([]);
  req.method=method;req.headers=range?{range}:{};
  const response={status:0,headers:{},chunks:[],writeHead(status,headers){this.status=status;this.headers=headers;},write(chunk){this.chunks.push(Buffer.from(chunk));},end(payload){if(payload!==undefined)this.chunks.push(Buffer.from(payload));}};
  let handled=false,error=null;
  try{
   handled=await handleLibraryFiles(req,response,path,db,async()=>requestUser,{
    storageFactory:()=>({s3:storageConfigured?s3:null,bucket:'private-test'})
   });
  }catch(err){error=err;}
  return {handled,error,status:response.status,headers:response.headers,body:Buffer.concat(response.chunks)};
 };
 return {invoke,dbCalls,s3Calls};
}

test('owner audio streams the full object with private no-store headers',async()=>{
 const f=fixture();
 const out=await f.invoke('/api/library/files/audio/11');
 assert.equal(out.handled,true);
 assert.equal(out.status,200);
 assert.equal(out.headers['Content-Type'],'audio/mpeg');
 assert.equal(out.headers['Content-Length'],bytes.length);
 assert.equal(out.headers['Accept-Ranges'],'bytes');
 assert.equal(out.headers['Cache-Control'],'private, no-store');
 assert.equal(out.headers['X-Content-Type-Options'],'nosniff');
 assert.equal(out.headers['Content-Range'],undefined);
 assert.deepEqual(out.body,bytes);
 assert.equal(f.s3Calls[0].Bucket,'private-test');
 assert.equal(f.s3Calls[0].Key,'users/7/assets/audio/verified.bin');
 assert.equal(f.s3Calls[0].Range,undefined);
 assert.ok(f.dbCalls.some(c=>c.sql?.includes('f.user_id=$2 AND f.kind=$3')&&c.args[1]===7&&c.args[2]==='audio'));
});

test('audio ranges return 206 and unsatisfiable ranges return 416 without touching R2',async()=>{
 const partial=fixture();
 const ranged=await partial.invoke('/api/library/files/audio/11',{range:'bytes=0-3'});
 assert.equal(ranged.status,206);
 assert.equal(ranged.headers['Content-Range'],'bytes 0-3/'+bytes.length);
 assert.equal(ranged.headers['Content-Length'],4);
 assert.deepEqual(ranged.body,bytes.subarray(0,4));
 assert.equal(partial.s3Calls[0].Range,'bytes=0-3');

 const unsatisfiable=fixture();
 const out=await unsatisfiable.invoke('/api/library/files/audio/11',{range:'bytes='+bytes.length+'-'});
 assert.equal(out.status,416);
 assert.equal(out.headers['Content-Range'],'bytes */'+bytes.length);
 assert.equal(out.headers['Cache-Control'],'private, no-store');
 assert.equal(unsatisfiable.s3Calls.length,0);
});

test('denied audio, stems and cover return owner-scoped 404 without R2 reads',async()=>{
 for(const [path,error] of [
  ['/api/library/files/audio/11','Audio not found'],
  ['/api/library/files/stems/24','Stems not found'],
  ['/api/library/files/cover/31','Cover not found']
 ]){
  const f=fixture({owned:false});
  const out=await f.invoke(path);
  assert.equal(out.status,404,path);
  assert.deepEqual(JSON.parse(out.body.toString()),{error},path);
  assert.equal(f.s3Calls.length,0,path);
 }
});

test('owner cover streams with its existing private five-minute cache contract',async()=>{
 const f=fixture();
 const out=await f.invoke('/api/library/files/cover/31');
 assert.equal(out.status,200);
 assert.equal(out.headers['Content-Type'],'image/png');
 assert.equal(out.headers['Cache-Control'],'private, max-age=300');
 assert.equal(out.headers['X-Content-Type-Options'],'nosniff');
 assert.deepEqual(out.body,bytes);
 assert.equal(f.s3Calls[0].Key,'users/7/assets/cover/verified.bin');
});

test('unreadable R2 cover bodies fail closed with a no-store 503 JSON response',async()=>{
 const f=fixture({bodyMode:'unreadable'});
 const out=await f.invoke('/api/library/files/cover/31');
 assert.equal(out.status,503);
 assert.equal(out.headers['Content-Type'],'application/json; charset=utf-8');
 assert.equal(out.headers['Cache-Control'],'no-store');
 assert.deepEqual(JSON.parse(out.body.toString()),{error:'Storage unavailable'});
});

test('anonymous requests stop at 401 before any database or R2 access',async()=>{
 const f=fixture();
 const out=await f.invoke('/api/library/files/audio/11',{requestUser:null});
 assert.equal(out.status,401);
 assert.deepEqual(JSON.parse(out.body.toString()),{error:'Not authenticated'});
 assert.equal(f.dbCalls.length,0);
 assert.equal(f.s3Calls.length,0);
});

test('unconfigured R2 storage stops at 503 before any database access',async()=>{
 const f=fixture({storageConfigured:false});
 const out=await f.invoke('/api/library/files/stems/24');
 assert.equal(out.status,503);
 assert.deepEqual(JSON.parse(out.body.toString()),{error:'Storage is not configured'});
 assert.equal(f.dbCalls.length,0);
 assert.equal(f.s3Calls.length,0);
});

test('R2 failures propagate instead of being converted into a success response',async()=>{
 const f=fixture({bodyMode:'throw'});
 const out=await f.invoke('/api/library/files/audio/11');
 assert.match(out.error.message,/R2 unavailable/);
 assert.equal(out.status,0);
});

test('partial R2 stream interruption keeps the partial body and never ends cleanly',async()=>{
 const f=fixture({bodyMode:'interrupt'});
 const out=await f.invoke('/api/library/files/audio/11');
 assert.match(out.error.message,/R2 stream interrupted/);
 assert.equal(out.status,200);
 assert.deepEqual(out.body,bytes.subarray(0,1));
});

test('non-numeric streaming IDs fall through to the generic 404 fallback',async()=>{
 for(const path of ['/api/library/files/audio/abc','/api/library/files/stems/1.5','/api/library/files/cover/%20']){
  const f=fixture();
  const out=await f.invoke(path);
  assert.equal(out.status,404,path);
  assert.deepEqual(JSON.parse(out.body.toString()),{error:'Not found'},path);
  assert.equal(f.s3Calls.length,0,path);
 }
});

test('metadata reads still dispatch after the streaming handler declines the path',async()=>{
 const f=fixture();
 const root=await f.invoke('/api/library/files');
 assert.equal(root.status,200);
 assert.deepEqual(JSON.parse(root.body.toString()),{files:[]});
 const items=await f.invoke('/api/library/files/items');
 assert.equal(items.status,200);
 assert.deepEqual(JSON.parse(items.body.toString()),{beats:[],packs:[]});
});
