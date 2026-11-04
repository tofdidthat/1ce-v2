import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {normalizeUsername,detectAvatar,handleProfileIdentity} from '../dist/profile-identity.js';

const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0]);
function request(method,body=Buffer.alloc(0),headers={}){
 const req=Readable.from(body.length?[body]:[]);
 req.method=method;req.headers=headers;return req;
}
function response(){
 const result={status:0,headers:{},chunks:[]};
 result.writeHead=(status,headers={})=>{result.status=status;result.headers=headers;};
 result.write=chunk=>{result.chunks.push(Buffer.from(chunk));};
 result.end=chunk=>{if(chunk)result.chunks.push(Buffer.from(chunk));};
 result.json=()=>JSON.parse(Buffer.concat(result.chunks).toString('utf8'));
 result.bytes=()=>Buffer.concat(result.chunks);
 return result;
}
function fakeBackend(){
 const state={username:null,avatar:null};
 const objects=new Map();
 const pool={
  async query(sql,args){
   if(sql.includes('SET username=')){state.username=args[0];return {rowCount:1,rows:[]};}
   if(sql.includes('SELECT avatar_key FROM account_users WHERE id='))return {rowCount:1,rows:[{avatar_key:state.avatar}]};
   throw Error('Unexpected query: '+sql);
  },
  async connect(){
   return {async query(sql,args){
    if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rowCount:0,rows:[]};
    if(sql.includes('SELECT avatar_key FROM account_users WHERE id='))return {rowCount:1,rows:[{avatar_key:state.avatar}]};
    if(sql.includes('UPDATE account_users SET avatar_key=')){state.avatar=args[0];return {rowCount:1,rows:[]};}
    throw Error('Unexpected transaction query: '+sql);
   },release(){}};
  }
 };
 const storageFactory=()=>({bucket:'isolated-v2-test',s3:{async send(cmd){
  const key=cmd.input.Key;
  if(cmd.constructor.name==='PutObjectCommand'){objects.set(key,cmd.input.Body);return {};}
  if(cmd.constructor.name==='DeleteObjectCommand'){objects.delete(key);return {};}
  if(cmd.constructor.name==='GetObjectCommand'){
   if(!objects.has(key)){const error=Error('Not found');error.name='NoSuchKey';throw error;}
   return {Body:Readable.from([objects.get(key)])};
  }
  throw Error('Unexpected S3 command');
 }}});
 const currentUser=async()=>({id:42,name:'Test',picture:'https://example.com/google.jpg',username:state.username,has_avatar:!!state.avatar,avatar_updated_at:'test'});
 return {state,objects,pool,storageFactory,currentUser};
}
test('username follows the v1 format but avoids numeric profile URL collisions',()=>{
 assert.equal(normalizeUsername(' @Studio.One '),'studio.one');
 assert.equal(normalizeUsername('ab'),null);
 assert.equal(normalizeUsername('hello..world'),null);
 assert.equal(normalizeUsername('all spaces'),null);
 assert.equal(normalizeUsername('12345'),null);
 assert.equal(normalizeUsername('a'.repeat(24)),'a'.repeat(24));
 assert.equal(normalizeUsername('a'.repeat(25)),null);
 assert.equal(normalizeUsername('a_2'),'a_2');
});
test('avatar validation checks file bytes, not only client supplied MIME',()=>{
 assert.deepEqual(detectAvatar(png),{type:'image/png',ext:'png'});
 assert.deepEqual(detectAvatar(Buffer.from([255,216,255,0])),{type:'image/jpeg',ext:'jpg'});
 assert.deepEqual(detectAvatar(Buffer.from('RIFF1234WEBP')), {type:'image/webp',ext:'webp'});
 assert.equal(detectAvatar(Buffer.from('<svg>bad</svg>')),null);
});
test('username update requires a session and returns the same account identity',async()=>{
 const h=fakeBackend();
 let res=response();
 await handleProfileIdentity(request('PATCH',Buffer.from(JSON.stringify({username:'@Artist.New'})),{'content-type':'application/json'}),res,'/auth/me',h.pool,h.currentUser);
 assert.equal(res.status,200);assert.equal(h.state.username,'artist.new');
 assert.equal(res.json().user.id,42);assert.equal(res.json().user.username,'artist.new');
 res=response();
 await handleProfileIdentity(request('PATCH',Buffer.from('{"username":"admin"}')),res,'/auth/me',h.pool,async()=>null);
 assert.equal(res.status,401);
 res=response();
 await handleProfileIdentity(request('PATCH',Buffer.from('{"username":"12"}')),res,'/auth/me',h.pool,h.currentUser);
 assert.equal(res.status,400);
});
test('duplicate username is a conflict, not a server error',async()=>{
 const h=fakeBackend();h.pool.query=async()=>{const error=Error('duplicate');error.code='23505';throw error;};
 const res=response();
 await handleProfileIdentity(request('PATCH',Buffer.from('{"username":"taken.name"}')),res,'/auth/me',h.pool,h.currentUser);
 assert.equal(res.status,409);
});
test('private R2 avatar upload, public read and authenticated removal use one object reference',async()=>{
 const h=fakeBackend();
 let res=response();
 await handleProfileIdentity(request('POST',png,{'content-type':'image/png'}),res,'/auth/me/avatar',h.pool,h.currentUser,{storageFactory:h.storageFactory});
 assert.equal(res.status,200);
 assert.equal(res.json().user.has_avatar,true);
 assert.ok(h.state.avatar.startsWith('users/42/avatar/'));
 assert.equal(h.objects.size,1);
 res=response();
 await handleProfileIdentity(request('GET'),res,'/api/public/avatar/42',h.pool,h.currentUser,{storageFactory:h.storageFactory});
 assert.equal(res.status,200);assert.equal(res.headers['Content-Type'],'image/png');
 assert.deepEqual(res.bytes(),png);
 res=response();
 await handleProfileIdentity(request('DELETE'),res,'/auth/me/avatar',h.pool,h.currentUser,{storageFactory:h.storageFactory});
 assert.equal(res.status,200);assert.equal(res.json().user.has_avatar,false);
 assert.equal(h.objects.size,0);
 res=response();
 await handleProfileIdentity(request('GET'),res,'/api/public/avatar/42',h.pool,h.currentUser,{storageFactory:h.storageFactory});
 assert.equal(res.status,404);
});
test('avatar upload rejects content-type spoofing before touching R2',async()=>{
 const h=fakeBackend();const res=response();
 await handleProfileIdentity(request('POST',png,{'content-type':'image/jpeg'}),res,'/auth/me/avatar',h.pool,h.currentUser,{storageFactory:h.storageFactory});
 assert.equal(res.status,415);assert.equal(h.objects.size,0);
});
test('avatar upload cannot be modified without authentication',async()=>{
 const h=fakeBackend();const res=response();
 await handleProfileIdentity(request('POST',png,{'content-type':'image/png'}),res,'/auth/me/avatar',h.pool,async()=>null,{storageFactory:h.storageFactory});
 assert.equal(res.status,401);assert.equal(h.objects.size,0);
});

test('anonymous avatar deletion and wrong-owner public reads never mutate private R2',async()=>{
 const h=fakeBackend();
 let res=response();
 await handleProfileIdentity(request('POST',png,{'content-type':'image/png'}),res,'/auth/me/avatar',h.pool,h.currentUser,{storageFactory:h.storageFactory});
 assert.equal(res.status,200);
 const original=h.state.avatar;
 assert.equal(h.objects.size,1);
 res=response();
 await handleProfileIdentity(request('DELETE'),res,'/auth/me/avatar',h.pool,async()=>null,{storageFactory:h.storageFactory});
 assert.equal(res.status,401);
 assert.equal(h.state.avatar,original);
 assert.equal(h.objects.size,1);
 res=response();
 await handleProfileIdentity(request('GET'),res,'/api/public/avatar/43',h.pool,h.currentUser,{storageFactory:h.storageFactory});
 assert.equal(res.status,404);
 assert.equal(h.objects.size,1);
});
