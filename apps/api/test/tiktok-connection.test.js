import test from 'node:test';
import assert from 'node:assert/strict';
import {beginTikTokConnection,startTikTokConnection,finishTikTokConnection,
 tiktokConnectionStatus,disconnectTikTok,tiktokConfig} from '../dist/tiktok-connection.js';
import {openPublishing,sealPublishing} from '../dist/publishing-secrets.js';

const config={clientKey:'synthetic-client-key',clientSecret:'fixture-tiktok-client-secret',
 redirectUri:'https://api.invalid/auth/tiktok/callback',webOrigin:'https://1ce.lol',
 encryptionSecret:'fixture-existing-publishing-master-key'};
const state='ttpub_'+'a'.repeat(43),browser='b'.repeat(43);
function response(){return{status:0,headers:{},writeHead(status,headers){this.status=status;this.headers=headers},end(){}}}
function callback(cookie='onece_v2_tiktok_state='+browser){
 return {req:{headers:{cookie}},url:new URL(config.redirectUri+'?state='+state+'&code=fixture-code')};
}
function dbMock({claim=true,revoke=true,profileId='test-open-id'}={}){
 const calls=[];
 const db={calls,async query(sql,args){
  calls.push({sql,args});
  if(sql.includes('SET claim_token=')||sql.includes('DELETE FROM v2_tiktok_oauth')&&sql.includes('claim_token='))
   return{rowCount:claim?1:0,rows:claim?[{user_id:42}]:[]};
  if(sql.includes('SELECT access_cipher FROM v2_tiktok_connections'))
   return{rowCount:1,rows:[{access_cipher:sealPublishing('synthetic-access','tiktok-access:42',config.encryptionSecret)}]};
  return{rowCount:1,rows:[{user_id:42}]};
 }};
 const pool={query:db.query,connect:async()=>({query:db.query,release(){}})};
 const http=async(url,options)=>{
  if(String(url).includes('/user/info/')){
   assert.equal(options.headers.Authorization,'Bearer synthetic-access');
   return Response.json({error:{code:'ok'},data:{user:{open_id:profileId,display_name:'Fixture creator'}}});
  }
  if(String(url).endsWith('/oauth/revoke/'))return new Response('',{status:revoke?200:500});
  assert.equal(String(url),'https://open.tiktokapis.com/v2/oauth/token/');
  assert.equal(options.method,'POST');
  assert.equal(options.body.get('client_secret'),config.clientSecret);
  assert.equal(options.body.get('redirect_uri'),config.redirectUri);
  return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',
   open_id:'test-open-id',scope:'user.info.basic,video.publish',
   expires_in:7200,refresh_expires_in:15552000});
 };
 return{db,pool,http,calls};
}

test('TikTok is unavailable without all dedicated credentials; defaults do not enable posting',()=>{
 const keys=['TIKTOK_CLIENT_KEY','TIKTOK_CLIENT_SECRET','TIKTOK_REDIRECT_URI','WEB_ORIGIN','GOOGLE_CLIENT_SECRET'];
 const backup=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try{
  keys.forEach(key=>delete process.env[key]);
  assert.equal(tiktokConfig(),null);
  Object.assign(process.env,{TIKTOK_CLIENT_KEY:'fixture-key',
   TIKTOK_CLIENT_SECRET:'fixture-secret',TIKTOK_REDIRECT_URI:config.redirectUri,
   WEB_ORIGIN:config.webOrigin,GOOGLE_CLIENT_SECRET:'fixture-oauth-secret-for-encryption'});
  assert.equal(tiktokConfig().clientKey,'fixture-key');
  process.env.TIKTOK_REDIRECT_URI='https://api.invalid/auth/tiktok/callback?bad=1';
  assert.equal(tiktokConfig(),null);
 }finally{for(const key of keys)backup[key]===undefined?delete process.env[key]:process.env[key]=backup[key];}
});
test('TikTok state is 256-bit, owner-scoped, one-use and bound to a secure browser cookie',async()=>{
 const {pool,calls}=dbMock();
 const result=await beginTikTokConnection(pool,42,config),url=new URL(result.url);
 const stateValue=url.searchParams.get('state');
 assert.match(stateValue,/^ttpub_[A-Za-z0-9_-]{43}$/);
 assert.equal(url.pathname,'/auth/tiktok/start');
 assert.equal(url.origin,'https://api.invalid');
 assert.ok(calls.some(x=>x.sql.includes('pg_advisory_xact_lock')));
 assert.doesNotMatch(JSON.stringify(calls),new RegExp(stateValue));
 const start=await startTikTokConnection(pool,42,stateValue,config);
 const target=new URL(start.url);
 assert.equal(target.origin,'https://www.tiktok.com');
 assert.equal(target.pathname,'/v2/auth/authorize/');
 assert.equal(target.searchParams.get('scope'),'user.info.basic,video.publish');
 assert.equal(target.searchParams.get('client_key'),config.clientKey);
 assert.equal(target.searchParams.get('redirect_uri'),config.redirectUri);
 assert.match(start.cookie,/HttpOnly; Secure; SameSite=Lax/);
 assert.match(start.cookie,/Path=\/auth\/tiktok\/callback/);
 assert.doesNotMatch(JSON.stringify(calls),new RegExp(stateValue));
});
test('TikTok callback refuses missing browser state and reused claims without provider contact',async()=>{
 const {pool}=dbMock({claim:false});
 let requests=0;
 for(const cookie of ['', 'onece_v2_tiktok_state='+browser]){
  const {req,url}=callback(cookie),res=response();
  await finishTikTokConnection(req,res,url,pool,config,42,async()=>{requests++;throw Error('Should not call TikTok')});
  assert.equal(res.status,302);
  assert.match(res.headers.Location,/^https:\/\/1ce\.lol\/app\/upload\?publishing=tiktok-error/);
  assert.match(res.headers['Set-Cookie'],/Max-Age=0/);
 }
 assert.equal(requests,0);
});
test('TikTok callback saves only encrypted access/refresh grants and validates scope',async()=>{
 const {pool,http,calls}=dbMock(),{req,url}=callback(),res=response();
 await finishTikTokConnection(req,res,url,pool,config,42,http);
 assert.equal(res.headers.Location,'https://1ce.lol/app/upload?publishing=tiktok-connected');
 const saved=calls.find(x=>x.sql.includes('INSERT INTO v2_tiktok_connections'));
 assert.ok(saved);
 assert.equal(saved.args[8],'Fixture creator');
 assert.equal(saved.args[0],42);
 assert.equal(saved.args[1],'test-open-id');
 assert.equal(openPublishing(saved.args[3],'tiktok-access:42',config.encryptionSecret),'synthetic-access');
 assert.equal(openPublishing(saved.args[4],'tiktok-refresh:42',config.encryptionSecret),'synthetic-refresh');
 assert.doesNotMatch(JSON.stringify(saved),/synthetic-access|synthetic-refresh/);
 assert.doesNotMatch(JSON.stringify(res),/fixture-code|synthetic-access|synthetic-refresh/);
});
test('TikTok User Info must match token subject before a connection is stored',async()=>{
 const {pool,http,calls}=dbMock({profileId:'another-account'}),{req,url}=callback(),res=response();
 await finishTikTokConnection(req,res,url,pool,config,42,http);
 assert.match(res.headers.Location,/tiktok_identity_mismatch/);
 assert.ok(!calls.some(x=>x.sql.includes('INSERT INTO v2_tiktok_connections')));
});
test('TikTok scope omission prevents connecting, even with a valid token',async()=>{
 const {pool}=dbMock(),{req,url}=callback(),res=response(),calls=[];
 await finishTikTokConnection(req,res,url,pool,config,42,async(_url,options)=>{
  calls.push(options);
  return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',
   open_id:'test-open-id',scope:'user.info.basic',expires_in:7200,refresh_expires_in:15552000});
 });
 assert.equal(calls.length,1);
 assert.match(res.headers.Location,/reason=tiktok_scope_not_approved/);
});
test('TikTok status depends on valid encrypted refresh credentials, not access-token expiry',async()=>{
 const row={refresh_cipher:sealPublishing('synthetic-refresh','tiktok-refresh:42',config.encryptionSecret),
  refresh_expires_at:new Date(Date.now()+86400000).toISOString(),scope:'user.info.basic,video.publish'};
 const db={async query(){return {rows:[row],rowCount:1}}};
 assert.deepEqual(await tiktokConnectionStatus(db,42,null),{available:false,connected:false,publishingEnabled:false});
 assert.deepEqual(await tiktokConnectionStatus(db,42,config),{available:true,connected:true,publishingEnabled:false});
 row.refresh_expires_at=new Date(Date.now()-86400000).toISOString();
 assert.deepEqual(await tiktokConnectionStatus(db,42,config),{available:true,connected:false,publishingEnabled:false});
});
test('TikTok disconnect removes local state, attempts revoke, reports provider failure',async()=>{
 const {pool,calls,http}=dbMock({revoke:false});
 const result=await disconnectTikTok(pool,42,config,http);
 assert.deepEqual(result,{providerRevoked:false});
 assert.ok(calls.some(x=>x.sql.includes('DELETE FROM v2_tiktok_connections')));
 assert.ok(calls.some(x=>x.sql.includes('DELETE FROM v2_tiktok_oauth')));
 assert.equal(calls.at(-1).sql,'COMMIT');
});
