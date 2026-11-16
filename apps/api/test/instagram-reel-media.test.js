import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Writable,Readable} from 'node:stream';
import {serveInstagramReelMedia,validateInstagramRange} from '../dist/instagram-reel-media.js';

const token='a'.repeat(43),hash=createHash('sha256').update(token).digest('hex');
const key='publishing/users/42/12345678-1234-4123-8123-123456789abc/9/'+'b'.repeat(64)+'.mp4';
const row={artifact_key:key,artifact_sha:'b'.repeat(64),artifact_bytes:5,user_id:42};
function response(){
 const chunks=[],res=new Writable({write(chunk,_enc,cb){chunks.push(Buffer.from(chunk));cb()}});
 res.writeHead=(status,headers)=>{res.status=status;res.headers=headers;return res;};
 res.status=0;res.headers={};res.content=()=>Buffer.concat(chunks).toString('utf8');
 return res;
}
function fixtures(rowValue=row){
 const queries=[],gets=[];
 const db={async query(sql,args){queries.push({sql,args});return{rows:rowValue?[rowValue]:[],rowCount:rowValue?1:0}}};
 const storage={bucket:'private-bucket',s3:{async send(cmd){
  gets.push(cmd.input);
  if(cmd.input.Range)return{Body:Readable.from([Buffer.from('CD')]),ContentLength:2};
  return{Body:Readable.from([Buffer.from('ABCDE')]),ContentLength:5};
 }}};
 return{db,storage,gets,queries};
}
const url=new URL('https://api.invalid/api/publishing/meta-media?token='+token);

test('private Reel media rejects invalid or missing grants before any R2 request',async()=>{
 for(const link of [new URL('https://api.invalid/api/publishing/meta-media'),
 new URL('https://api.invalid/api/publishing/meta-media?token=short'),
 new URL(url.href+'&additional=1')]){
  const fx=fixtures(),res=response();
  await serveInstagramReelMedia({method:'GET',headers:{}},res,link,fx.db,{storage:fx.storage});
  assert.equal(res.status,404);assert.equal(fx.gets.length,0);
 }
 const fx=fixtures(null),res=response();
 await serveInstagramReelMedia({method:'GET',headers:{}},res,url,fx.db,{storage:fx.storage});
 assert.equal(res.status,404);assert.equal(fx.gets.length,0);
 assert.equal(fx.queries[0].args[0],hash);
 assert.doesNotMatch(JSON.stringify(fx.queries),new RegExp(token));
});
test('private Reel delivery only uses rendered artifact within owner-scoped prefix',async()=>{
 const fx=fixtures({...row,artifact_key:key.replace('users/42/','users/99/')}),res=response();
 await serveInstagramReelMedia({method:'GET',headers:{}},res,url,fx.db,{storage:fx.storage});
 assert.equal(res.status,404);assert.equal(fx.gets.length,0);
});
test('Meta can retrieve video via short-lived capability without library credentials',async()=>{
 const fx=fixtures(),res=response();
 await serveInstagramReelMedia({method:'GET',headers:{}},res,url,fx.db,{storage:fx.storage});
 assert.equal(res.status,200);assert.equal(res.content(),'ABCDE');
 assert.equal(res.headers['Content-Type'],'video/mp4');
 assert.equal(res.headers['Content-Length'],'5');
 assert.equal(fx.gets[0].Key,key);
 assert.equal(fx.gets[0].Bucket,'private-bucket');
 assert.doesNotMatch(JSON.stringify(fx.gets),new RegExp(token));
});
test('Meta HEAD and byte-range fetch are bounded and not cached',async()=>{
 const fx=fixtures(),head=response();
 await serveInstagramReelMedia({method:'HEAD',headers:{}},head,url,fx.db,{storage:fx.storage});
 assert.equal(head.status,200);assert.equal(head.content(),'');assert.equal(fx.gets.length,0);
 const res=response();
 await serveInstagramReelMedia({method:'GET',headers:{range:'bytes=2-3'}},res,url,fx.db,{storage:fx.storage});
 assert.equal(res.status,206);assert.equal(res.content(),'CD');assert.equal(fx.gets[0].Range,'bytes=2-3');
 assert.equal(res.headers['Content-Range'],'bytes 2-3/5');
 assert.equal(res.headers['Cache-Control'],'no-store');
 assert.deepEqual(validateInstagramRange('bytes=4-10',5),null);
 assert.deepEqual(validateInstagramRange('bytes=-1',5),null);
});
