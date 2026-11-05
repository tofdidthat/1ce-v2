import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {handleLibraryFiles} from '../dist/library-files.js';
const blob=Buffer.from('PK-test-zip');

function fixture({user={id:7},owned=true}={}){
 const calls=[];
 const db={
  query:async(sql,args)=>{
   calls.push({sql,args});
   if(sql.includes('FROM library_files f')){
    return {rowCount:owned?1:0,rows:owned?[{object_key:'users/7/assets/stems/verified.zip',content_type:'application/zip',byte_size:blob.length}]:[]};
   }
   if(sql.includes('FROM library_beats b')){
    return {rowCount:owned?1:0,rows:owned?[{id:'aabbccdd-1234-4123-8123-abcdef123456',title:'My Beat',audio_file_id:'11',stems_file_id:'24'}]:[]};
   }
   return {rowCount:0,rows:[]};
  }
 };
 const s3={send:async(command)=>{
  calls.push({command:command.constructor.name,input:command.input});
  const range=command.input.Range;
  const bytes=range?blob.subarray(Number(range.match(/bytes=(\d+)-/)[1]),Number(range.match(/-(\d+)$/)[1])+1):blob;
  return {Body:Readable.from([bytes])};
 }};
 const invoke=async(path,requestUser=user,range)=>{
  const req=Readable.from([]);
  req.method='GET';req.headers=range?{range}:{};
  const response={status:0,headers:{},bytes:[],writeHead(status,headers){this.status=status;this.headers=headers;},write(bytes){this.bytes.push(Buffer.from(bytes));},end(payload){if(payload)this.bytes.push(Buffer.from(payload));}};
  const handled=await handleLibraryFiles(req,response,path,db,async()=>requestUser,{storageFactory:()=>({s3,bucket:'private-test'})});
  return {handled,status:response.status,headers:response.headers,bytes:Buffer.concat(response.bytes)};
 };
 return {invoke,calls};
}
test('owner can stream original verified stems ZIP using the existing authorization policy',async()=>{
 const f=fixture();
 const out=await f.invoke('/api/library/files/stems/24');
 assert.equal(out.handled,true);
 assert.equal(out.status,200);
 assert.equal(out.headers['Content-Type'],'application/zip');
 assert.deepEqual(out.bytes,blob);
 assert.ok(f.calls.some(c=>c.sql?.includes("f.user_id=$2 AND f.kind=$3")&&c.args[2]==='stems'));
 assert.ok(f.calls.some(c=>c.command==='GetObjectCommand'&&c.input.Key==='users/7/assets/stems/verified.zip'));
});
test('nonowner and anonymous requests cannot read stems, even by knowing a file ID',async()=>{
 const missing=fixture({owned:false});
 const deny=await missing.invoke('/api/library/files/stems/24');
 assert.equal(deny.status,404);
 assert.equal(missing.calls.some(c=>c.command==='GetObjectCommand'),false);
 const anon=fixture();
 assert.equal((await anon.invoke('/api/library/files/stems/24',null)).status,401);
 assert.equal(anon.calls.length,0);
});
test('owner stems download supports standard Range responses without public files',async()=>{
 const f=fixture();
 const out=await f.invoke('/api/library/files/stems/24',{id:7},'bytes=0-1');
 assert.equal(out.status,206);
 assert.equal(out.headers['Content-Range'],'bytes 0-1/'+blob.length);
 assert.equal(out.bytes.toString(),'PK');
});
test('owner beat metadata returns existing IDs without leaking other accounts',async()=>{
 const f=fixture();
 const id='aabbccdd-1234-4123-8123-abcdef123456';
 const out=await f.invoke('/api/library/files/beat/'+id);
 assert.equal(out.status,200);
 const data=JSON.parse(out.bytes.toString());
 assert.equal(data.beat.stems_file_id,'24');
 assert.ok(f.calls.some(c=>c.sql?.includes('b.user_id=$2')&&c.args[1]===7));
 const missing=fixture({owned:false});
 assert.equal((await missing.invoke('/api/library/files/beat/'+id)).status,404);
});
