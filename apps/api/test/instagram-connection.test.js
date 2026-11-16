import test from 'node:test';
import assert from 'node:assert/strict';
import {beginInstagramConnection as beginConnection,startInstagramConnection as startConnection,finishInstagramConnection as finishConnection,
 instagramConnectionStatus,disconnectInstagram,instagramConfig} from '../dist/instagram-connection.js';
import {openPublishing} from '../dist/publishing-secrets.js';
const config={appId:'123456',appSecret:'fixture-meta-secret-not-real',redirectUri:'https://api.invalid/auth/instagram/callback',
 webOrigin:'https://1ce.lol',encryptionSecret:'fixture-existing-publishing-master-key'};

function pool(db){
 const query=(sql,args)=>sql.startsWith('SELECT 1 FROM v2_instagram_data_deletions')
  ?Promise.resolve({rowCount:0,rows:[]}):db.query(sql,args);
 return{query,async connect(){return{query,release(){}}}};
}
const beginInstagramConnection=(db,...args)=>beginConnection(pool(db),...args);
const startInstagramConnection=(db,...args)=>startConnection(pool(db),...args);
const finishInstagramConnection=(req,res,url,db,...args)=>finishConnection(req,res,url,pool(db),...args);

test('pending deletion blocks a new OAuth transaction under the owner lock',async()=>{
 const calls=[],client={async query(sql,args){calls.push({sql,args});return{rowCount:sql.includes('FROM v2_instagram_data_deletions')?1:0,rows:[]}},release(){}};
 await assert.rejects(beginConnection({connect:async()=>client,query:client.query},42,config),{code:'instagram_data_deletion_pending'});
 assert.ok(calls.some(call=>call.sql==='ROLLBACK'));assert.equal(calls.some(call=>call.sql.startsWith('INSERT')),false);
});

test('an OAuth claim erased by deletion cannot reconnect even after cleanup has finished',async()=>{
 const calls=[],db={async query(sql,args){calls.push({sql,args});
  return sql.startsWith('DELETE FROM v2_instagram_oauth WHERE state_hash=')?{rowCount:0,rows:[]}:{rowCount:1,rows:[{user_id:42}]};
 }};
 const http=async url=>String(url).startsWith('https://api.instagram.com/')
  ?Response.json({user_id:'123456789',access_token:'synthetic-short'})
  :String(url).startsWith('https://graph.instagram.com/access_token')
   ?Response.json({access_token:'synthetic-long',expires_in:5184000}):Response.json({id:'123456789',username:'fixture'});
 const input=callback(),output=response();
 await finishInstagramConnection(input.req,output,input.url,db,config,42,http);
 assert.match(output.headers.Location,/instagram-error&reason=instagram_state_expired/);
 assert.equal(calls.some(call=>call.sql.includes('INSERT INTO v2_instagram_connections')),false);
});

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
 assert.equal(url.searchParams.get('enable_fb_login'),'0');
 assert.equal(url.searchParams.get('force_authentication'),'1');
 assert.doesNotMatch(JSON.stringify(queries),new RegExp(state));
 assert.equal(queries.find(v=>v.sql.startsWith('UPDATE')).args[1],42);
});
test('Instagram callback rejects missing browser cookie and state replay without Meta calls',async()=>{
 let calls=0;const db={async query(){return{rowCount:0,rows:[]}}};
 for(const cookie of ['', 'onece_v2_instagram_state='+'b'.repeat(43)]){
  const {req,url}=callback(undefined,cookie),res=response();
  await finishInstagramConnection(req,res,url,db,config,42,async()=>{calls++;throw Error('provider should not be contacted')});
  assert.equal(res.status,302);assert.match(res.headers.Location,/^https:\/\/1ce\.lol\/app\/upload\?publishing=instagram-error&reason=instagram_(consent_denied|state_expired)$/);
  assert.match(res.headers['Set-Cookie'],/Max-Age=0/);
 }
 assert.equal(calls,0);
});
test('Instagram exchange verifies account, encrypts long-lived token and returns no credentials to browser',async()=>{
 const queries=[];
 const db={async query(sql,args){queries.push({sql,args});return sql.startsWith('DELETE')||sql.startsWith('UPDATE v2_instagram_oauth SET claim_token')?
  {rowCount:1,rows:[{user_id:42}]}:{rowCount:1,rows:[]}}};
 const http=async(url,init)=>{
  const host=new URL(String(url)).hostname;
  if(host==='api.instagram.com'){
   assert.equal(new URL(String(url)).search,'');assert.equal(init.method,'POST');
   assert.equal(init.body.get('client_secret'),config.appSecret);assert.equal(init.body.get('code'),'fixture-code');
   return new Response('{"access_token":"short-token-fixture","user_id":17841405309211844}',{headers:{'Content-Type':'application/json'}});
  }
  if(host==='graph.instagram.com'&&String(url).includes('/access_token'))return Response.json({access_token:'long-token-fixture',expires_in:5184000});
  if(host==='graph.instagram.com'&&String(url).includes('/me?')){
   assert.equal(new URL(String(url)).searchParams.has('access_token'),false);
   assert.equal(init.headers.Authorization,'Bearer long-token-fixture');
   return new Response('{"id":17841405309211844,"user_id":28621378697485455,"username":"artist.fixture"}',{headers:{'Content-Type':'application/json'}});
  }
  throw Error('Unexpected URL');
 };
 const {req,url}=callback(),res=response();
 await finishInstagramConnection(req,res,url,db,config,42,http);
 assert.equal(res.headers.Location,'https://1ce.lol/app/upload?publishing=instagram-connected');
 const save=queries.find(q=>q.sql.includes('INSERT INTO v2_instagram_connections'));
 assert.ok(save);
 assert.equal(save.args[0],42);assert.equal(save.args[1],'17841405309211844');
 assert.equal(save.args[2],'artist.fixture');
 assert.equal(openPublishing(save.args[3],'instagram-access:42',config.encryptionSecret),'long-token-fixture');
 assert.match(save.args[6],/^[a-f0-9]{64}$/,'Meta identity tombstone stores a one-way hash');
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
 assert.match(res.headers.Location,/instagram-error&reason=instagram_(professional_account_required|identity_mismatch)$/);
 assert.equal(queries.some(q=>q.sql.includes('INSERT INTO v2_instagram_connections')),false);
});
test('status uses local ciphertext, never leaks access token, disconnect is account scoped',async()=>{
 const row={username:'fixture',expires_at:new Date(Date.now()+86400000).toISOString(),
  instagram_user_id:'17841405309211844',
  access_cipher:(await import('../dist/publishing-secrets.js')).sealPublishing('long-token-fixture','instagram-access:42',config.encryptionSecret)};
 const queries=[],db={async query(sql,args){queries.push({sql,args});return{rows:[row],rowCount:1}}};
 assert.deepEqual(await instagramConnectionStatus(db,42,null),
  {available:false,connected:false,username:null,publishingEnabled:false});
 assert.deepEqual(await instagramConnectionStatus(db,42,config),
  {available:true,connected:true,username:'fixture',publishingEnabled:false});
 await disconnectInstagram(db,42);
 assert.equal(queries.filter(q=>q.sql.startsWith('DELETE')).length,2);
 assert.ok(queries.some(q=>q.sql.includes('INSERT INTO v2_instagram_compliance_subjects')));
 assert.ok(queries.every(q=>q.args[0]===42));
});

test('Meta app from v1 uses CLIENT_ID/CLIENT_SECRET without creating new app credentials',()=>{
 const keys=['INSTAGRAM_CLIENT_ID','INSTAGRAM_CLIENT_SECRET','INSTAGRAM_APP_ID','INSTAGRAM_APP_SECRET',
  'INSTAGRAM_REDIRECT_URI','WEB_ORIGIN','GOOGLE_CLIENT_SECRET','YOUTUBE_CLIENT_SECRET','PUBLISH_TOKEN_KEY'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try{
  for(const key of keys)delete process.env[key];
  process.env.INSTAGRAM_CLIENT_ID='v1-existing-ig-client-id';
  process.env.INSTAGRAM_CLIENT_SECRET='v1-existing-ig-client-secret';
  process.env.INSTAGRAM_REDIRECT_URI='https://api.invalid/auth/instagram/callback';
  process.env.WEB_ORIGIN='https://1ce.lol';
  process.env.GOOGLE_CLIENT_SECRET='existing-stable-encryption-key';
  const value=instagramConfig();
  assert.equal(value.appId,'v1-existing-ig-client-id');
  assert.equal(value.appSecret,'v1-existing-ig-client-secret');
  assert.equal(value.encryptionSecret,'existing-stable-encryption-key');
  process.env.INSTAGRAM_APP_ID='different-meta-app';
  assert.equal(instagramConfig(),null,'conflicting app IDs must fail closed');
  delete process.env.INSTAGRAM_APP_ID;
  process.env.INSTAGRAM_APP_SECRET='different-meta-secret';
  assert.equal(instagramConfig(),null,'conflicting app secrets must fail closed');
 }finally{
  for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
 }
});
test('Instagram callback refuses identity not matching any OAuth account ID',async()=>{
 let created=false;
 const db={async query(sql){if(sql.includes('INSERT INTO v2_instagram_connections'))created=true;
  return{rowCount:1,rows:[{user_id:42}]}}};
 const http=async(url)=>{
  const host=new URL(String(url)).hostname;
  if(host==='api.instagram.com')return new Response('{"user_id":17841405309211844,"access_token":"short"}');
  if(host==='graph.instagram.com'&&String(url).includes('/access_token'))
   return Response.json({access_token:'long',expires_in:5184000});
  return new Response('{"id":28621378697485455,"user_id":28621378697485456,"username":"wrong.account"}');
 };
 const {req,url}=callback(),res=response();
 await finishInstagramConnection(req,res,url,db,config,42,http);
 assert.match(res.headers.Location,/instagram-error&reason=instagram_(professional_account_required|identity_mismatch)$/);
 assert.equal(created,false);
});

test('callback identifies short-token rejection without leaking provider payload',async()=>{
 const db={async query(){return {rowCount:1,rows:[{user_id:42}]}}};
 let logs=[];const previous=console.warn;console.warn=(...args)=>logs.push(args);
 try{
  const {req,url}=callback(),res=response();
  await finishInstagramConnection(req,res,url,db,config,42,async()=>new Response(
   JSON.stringify({error:{message:'fixture-provider-private-info',code:400}}),{status:400}));
  assert.equal(new URL(res.headers.Location).searchParams.get('reason'),'instagram_code_exchange_failed');
  assert.equal(res.status,302);
  assert.doesNotMatch(JSON.stringify(logs)+JSON.stringify(res),/fixture-provider-private-info|fixture-code/);
 }finally{console.warn=previous}
});
test('callback identifies lost 1CE account session before token exchange',async()=>{
 const {req,url}=callback(),res=response();let calls=0;
 const previous=console.warn;console.warn=()=>{};
 try{
  await finishInstagramConnection(req,res,url,{query:async()=>{throw Error('Must not query')}} ,config,null,
   async()=>{calls++;throw Error('Must not fetch')});
  assert.equal(new URL(res.headers.Location).searchParams.get('reason'),'instagram_session_missing');
  assert.equal(calls,0);
 }finally{console.warn=previous}
});
test('Meta variant with wrapped short token and string expiry is accepted',async()=>{
 const queries=[],db={async query(sql,args){queries.push({sql,args});return {rowCount:1,rows:[{user_id:42}]}}};
 const http=async url=>{
  if(String(url).startsWith('https://api.instagram.com/'))
   return new Response('{"data":[{"user_id":"17841405309211844","access_token":"short-fixture"}]}');
  if(String(url).startsWith('https://graph.instagram.com/access_token'))
   return Response.json({access_token:'long-fixture',expires_in:'5184000'});
  return new Response('{"id":"17841405309211844","username":"studio_fixture"}');
 };
 const {req,url}=callback(),res=response();
 await finishInstagramConnection(req,res,url,db,config,42,http);
 assert.match(res.headers.Location,/instagram-connected$/);
 assert.ok(queries.some(q=>q.sql.includes('INSERT INTO v2_instagram_connections')));
});
