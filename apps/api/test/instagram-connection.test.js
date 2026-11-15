import test from 'node:test';
import assert from 'node:assert/strict';
import {beginInstagramConnection,startInstagramConnection,finishInstagramConnection,
 instagramConnectionStatus,disconnectInstagram} from '../dist/instagram-connection.js';
import {openPublishing} from '../dist/publishing-secrets.js';

const config={appId:'123456',appSecret:'fixture-meta-secret-not-real',redirectUri:'https://api.invalid/auth/instagram/callback',
 webOrigin:'https://1ce.lol',encryptionSecret:'fixture-existing-publishing-master-key'};
function response(){return{status:0,headers:{},body:'',writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=body||''}}}
function callback(state='igpub_'+'a'.repeat(43),cookie='onece_v2_instagram_state='+'b'.repeat(43)){
 const req={headers:{cookie}},url=new URL(config.redirectUri+'?state='+state+'&code=fixture-code');
 return {req,url};
}

test('Instagram connect is account-bound, one-time and uses an HTTPS backend start URL',async()=>{
 const queries=[];const db={async query(sql,args){queries.push({sql,args});return{rowCount:1,rows:[{user_id:42}]}}};
 const ticket=await beginInstagramConnection(db,42,config),state=new URL(ticket.url).searchParams.get('state');
 assert.match(state,/^igpub_[A-Za-z0-9_-]{43}$/);
 assert.equal(new URL(ticket.url).pathname,'/auth/instagram/start');
 assert.equal(new URL(ticket.url).origin,'https://api.invalid');
 const result=await startInstagramConnection(db,42,state,config);
 const url=new URL(result.url);
 assert.equal(url.origin,'https://www.instagram.com');
 assert.equal(url.pathname,'/oauth/authorize');
 assert.equal(url.searchParams.get('client_id'),config.appId);
 assert.equal(url.searchParams.get('redirect_uri'),config.redirectUri);
 assert.equal(url.searchParams.get('state'),state);
 assert.match(url.searchParams.get('scope'),/instagram_business_basic/);
 assert.match(url.searchParams.get('scope'),/instagram_business_content_publish/);
 assert.match(result.cookie,/HttpOnly; Secure; SameSite=Lax/);
 assert.doesNotMatch(JSON.stringify(queries),new RegExp(state));
 assert.equal(queries.find(v=>v.sql.startsWith('UPDATE')).args[1],42);
});
test('Instagram callback rejects missing browser cookie and state replay without Meta calls',async()=>{
 let calls=0;const db={async query(){return{rowCount:0,rows:[]}}};
 for(const cookie of ['', 'onece_v2_instagram_state='+'b'.repeat(43)]){
  const {req,url}=callback(undefined,cookie),res=response();
  await finishInstagramConnection(req,res,url,db,config,42,async()=>{calls++;throw Error('provider should not be contacted')});
  assert.equal(res.status,302);assert.equal(res.headers.Location,'https://1ce.lol/app/upload?publishing=instagram-error');
  assert.match(res.headers['Set-Cookie'],/Max-Age=0/);
 }
 assert.equal(calls,0);
});
test('Instagram exchange verifies account, encrypts long-lived token and returns no credentials to browser',async()=>{
 const queries=[];
 const db={async query(sql,args){queries.push({sql,args});return sql.startsWith('DELETE')?
  {rowCount:1,rows:[{user_id:42}]}:{rowCount:1,rows:[]}}};
 const http=async(url)=>{
  const host=new URL(String(url)).hostname;
  if(host==='api.instagram.com')return Response.json({access_token:'short-token-fixture',user_id:123456789});
  if(host==='graph.instagram.com'&&String(url).includes('/access_token'))return Response.json({access_token:'long-token-fixture',expires_in:5184000});
  if(host==='graph.instagram.com'&&String(url).includes('/me?'))return Response.json({user_id:'123456789',username:'artist.fixture',account_type:'BUSINESS'});
  throw Error('Unexpected URL');
 };
 const {req,url}=callback(),res=response();
 await finishInstagramConnection(req,res,url,db,config,42,http);
 assert.equal(res.headers.Location,'https://1ce.lol/app/upload?publishing=instagram-connected');
 const save=queries.find(q=>q.sql.includes('INSERT INTO v2_instagram_connections'));
 assert.ok(save);
 assert.equal(save.args[0],42);assert.equal(save.args[1],'123456789');
 assert.equal(save.args[2],'artist.fixture');
 assert.equal(openPublishing(save.args[3],'instagram-access:42',config.encryptionSecret),'long-token-fixture');
 assert.doesNotMatch(JSON.stringify(save),/long-token-fixture|short-token-fixture/);
 assert.doesNotMatch(JSON.stringify(res),/token-fixture|fixture-code/);
});
test('personal accounts cannot be connected or stored',async()=>{
 const queries=[];
 const db={async query(sql,args){queries.push({sql,args});return{rowCount:1,rows:[{user_id:42}]}}};
 const http=async(url)=>{
  if(String(url).includes('api.instagram.com'))return Response.json({access_token:'fixture-short',user_id:123456789});
  if(String(url).includes('/access_token'))return Response.json({access_token:'fixture-long',expires_in:5184000});
  return Response.json({user_id:'123456789',username:'fixture',account_type:'PERSONAL'});
 };
 const {req,url}=callback(),res=response();
 await finishInstagramConnection(req,res,url,db,config,42,http);
 assert.match(res.headers.Location,/instagram-error$/);
 assert.equal(queries.some(q=>q.sql.includes('INSERT INTO v2_instagram_connections')),false);
});
test('status uses local ciphertext, never leaks access token, disconnect is account scoped',async()=>{
 const row={username:'fixture',expires_at:new Date(Date.now()+86400000).toISOString(),
  access_cipher:(await import('../dist/publishing-secrets.js')).sealPublishing('long-token-fixture','instagram-access:42',config.encryptionSecret)};
 const queries=[],db={async query(sql,args){queries.push({sql,args});return{rows:[row],rowCount:1}}};
 assert.deepEqual(await instagramConnectionStatus(db,42,null),
  {available:false,connected:false,username:null,publishingEnabled:false});
 assert.deepEqual(await instagramConnectionStatus(db,42,config),
  {available:true,connected:true,username:'fixture',publishingEnabled:false});
 await disconnectInstagram(db,42);
 assert.equal(queries.filter(q=>q.sql.startsWith('DELETE')).length,2);
 assert.ok(queries.every(q=>q.args[0]===42));
});
