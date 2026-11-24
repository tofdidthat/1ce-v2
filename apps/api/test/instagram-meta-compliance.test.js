import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash,createHmac} from 'node:crypto';
import {handleInstagramMetaCompliance,instagramMetaConfig,parseMetaSignedRequest} from '../dist/instagram-meta-compliance.js';
import {ensurePublishingSchema} from '../dist/publishing-schema.js';
import {deletionCodeHash,serveInstagramDataDeletionStatus} from '../dist/instagram-data-deletion.js';

const secret='synthetic-meta-app-secret-for-tests';
const config={appId:'synthetic-id',appSecret:secret,redirectUri:'https://api.invalid/auth/instagram/callback',
 webOrigin:'https://1ce.lol',encryptionSecret:'synthetic-publishing-master-key'};
function signedRequest(userId='17841405309211844'){
 const payload=Buffer.from(JSON.stringify({algorithm:'HMAC-SHA256',user_id:userId})).toString('base64url');
 const signature=createHmac('sha256',secret).update(payload).digest('base64url');
 return signature+'.'+payload;
}
function req(action='deauthorize',signed=signedRequest()){
 const body=new URLSearchParams({signed_request:signed}).toString();
 const request=Readable.from([body]);request.method='POST';request.headers={'content-type':'application/x-www-form-urlencoded'};
 return {request,url:new URL('https://api.invalid/api/instagram/meta-compliance'+(action==='deauthorize'?'':'?action='+action))};
}
function res(){return{status:0,headers:{},body:'',setHeader(name,value){this.headers[name]=value},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers)},end(value){this.body=value||''}};}
function pool({matched=false,scopeUnresolved=false,prior=null,withDeletion=false,fail=false}={}){
 const calls=[],receipts=new Map(),deletions=new Map(),state={connected:matched,known:matched};const client={async query(sql,args){calls.push({sql,args});
  if(sql.startsWith('SELECT request_hash FROM v2_instagram_data_deletions'))return{rowCount:deletions.has(args[0])?1:0,rows:deletions.has(args[0])?[{}]:[]};
  if(sql==='BEGIN'&&fail)throw Error('synthetic database failure');
  if(sql.includes('AS scope_unresolved'))return{rows:[{matched_owners:1,scope_unresolved:scopeUnresolved}]};
  if(sql.startsWith('INSERT INTO v2_instagram_data_deletions'))deletions.set(args[0],{owners:args[2],hash:args[1]});
  if(sql.startsWith('SELECT 1 FROM v2_instagram_data_deletions')){
   const found=withDeletion||deletions.get(args[0])?.hash===args[1];
   return {rowCount:found?1:0,rows:[]};
  }
  if(sql.startsWith('SELECT user_id FROM v2_instagram_connections'))return{rowCount:state.known?1:0,rows:state.known?[{user_id:42}]:[]};
  if(sql.startsWith('SELECT 1 FROM v2_instagram_compliance_subjects'))return{rowCount:state.known?1:0,rows:[]};
  if(sql.startsWith('SELECT legacy_response')){
   const receipt=receipts.get(args[0])??prior;
   return{rowCount:receipt?1:0,rows:receipt?[receipt]:[]};
  }
  if(sql.startsWith('INSERT INTO v2_instagram_compliance_receipts'))receipts.set(args[0],{legacy_response:null,v2_only:true});
  if(sql.includes('SELECT user_id,generation FROM v2_instagram_connections'))return{rowCount:state.connected?1:0,rows:state.connected?[{user_id:42,generation:'00000000-0000-4000-8000-000000000001'}]:[]};
  if(sql.startsWith('SELECT 1 FROM v2_instagram_connections'))return{rowCount:state.known?1:0,rows:state.known?[{one:1}]:[]};
  if(sql.startsWith('DELETE FROM v2_instagram_connections'))state.connected=false;
  return{rowCount:1,rows:[]};},release(){}};
 return{calls,state,query:client.query,async connect(){return client}};
}
test('signed_request verifies HMAC and preserves large Meta user ids exactly',()=>{
 assert.deepEqual(parseMetaSignedRequest(signedRequest(),'synthetic-meta-app-secret-for-tests'),{userId:'17841405309211844'});
 assert.throws(()=>parseMetaSignedRequest(signedRequest(),'different-synthetic-secret'),/signature/);
});

test('alternate base64 spelling cannot bypass an existing callback replay receipt',async()=>{
 const [signature,payload]=signedRequest().split('.');
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
 const alternate=signature.slice(0,-1)+alphabet[alphabet.indexOf(signature.at(-1))+1];
 assert.deepEqual(Buffer.from(alternate,'base64url'),Buffer.from(signature,'base64url'));
 const input=req('data-deletion',alternate+'.'+payload),db=pool({matched:true}),output=res();
 await handleInstagramMetaCompliance(input.request,output,input.url,db,config);
 assert.equal(output.status,400);assert.equal(db.calls.length,0);
});

test('valid HMAC does not admit an unsupported algorithm or malformed user id',()=>{
 for(const data of [{algorithm:'SHA1',user_id:'123'},{algorithm:'HMAC-SHA256',user_id:'not-a-meta-id'}]){
  const payload=Buffer.from(JSON.stringify(data)).toString('base64url');
  const signed=createHmac('sha256',secret).update(payload).digest('base64url')+'.'+payload;
  assert.throws(()=>parseMetaSignedRequest(signed,secret));
 }
 const payload=Buffer.from('{"algorithm":"HMAC-SHA256","user_id":17841405309211844}').toString('base64url');
 assert.equal(parseMetaSignedRequest(createHmac('sha256',secret).update(payload).digest('base64url')+'.'+payload,secret).userId,
  '17841405309211844');
});

test('duplicate signed_request fields and oversized callbacks are rejected before storage or forwarding',async()=>{
 for(const body of ['signed_request='+signedRequest()+'&signed_request='+signedRequest(),'a'.repeat(16385)]){
  const request=Readable.from([body]);request.method='POST';request.headers={'content-type':'application/x-www-form-urlencoded'};
  const db=pool(),response=res();
  await handleInstagramMetaCompliance(request,response,new URL('https://api.invalid/api/instagram/meta-compliance'),db,config);
  assert.equal(response.status,400);assert.equal(db.calls.length,0);
 }
});

async function invoke(db,action='deauthorize',meta=config,signed=signedRequest()){
 const {request,url}=req(action,signed),output=res();
 await handleInstagramMetaCompliance(request,output,url,db,meta);
 return output;
}

test('callback configuration needs no OAuth redirect or publishing credential',()=>{
 const env={INSTAGRAM_CLIENT_SECRET:secret,WEB_ORIGIN:'https://1ce.lol/'};
 assert.equal(instagramMetaConfig(env),null);
 const approved={...env,INSTAGRAM_META_CUTOVER_APPROVED:'true'};
 assert.deepEqual(instagramMetaConfig(approved),
  {appSecret:secret,webOrigin:'https://1ce.lol'});
 assert.equal(instagramMetaConfig({...approved,INSTAGRAM_APP_SECRET:'conflicting'}),null);
 assert.equal(instagramMetaConfig({...approved,WEB_ORIGIN:'https://1ce.lol/legacy'}),null);
});

test('deauthorization fences work and replay cannot revoke a later connection',async()=>{
 const db=pool({matched:true});
 assert.deepEqual(JSON.parse((await invoke(db)).body),{success:true});
 assert.equal(db.state.connected,false);
 assert.ok(db.calls.some(call=>call.sql.includes("state='needs_review'")));
 assert.ok(db.calls.some(call=>call.sql.includes('INSERT INTO v2_instagram_compliance_subjects')&&
  call.args[1]===createHash('sha256').update('instagram-meta-subject:17841405309211844').digest('hex')));
 db.state.connected=true;
 assert.equal((await invoke(db)).status,200);
 assert.equal(db.state.connected,true);
 assert.equal(db.calls.filter(call=>call.sql.startsWith('INSERT INTO v2_instagram_compliance_receipts')).length,1);
});

test('deletion after deauthorization schedules local cleanup once and issues a stable V2 receipt',async()=>{
 const db=pool({matched:true});
 assert.equal((await invoke(db)).status,200);
 const first=await invoke(db,'data-deletion'),replay=await invoke(db,'data-deletion');
 assert.equal(first.status,200);
 assert.equal(replay.body,first.body);
 const receipt=JSON.parse(first.body);
 assert.equal(new URL(receipt.url).pathname,'/api/instagram/data-deletion-status');
 assert.match(receipt.confirmation_code,/^[a-f0-9]{32}$/);
 assert.equal(db.calls.filter(call=>call.sql.startsWith('INSERT INTO v2_instagram_data_deletions')).length,1);
 assert.equal(db.calls.some(call=>/DELETE FROM (account_users|library_)/.test(call.sql)),false);
});

test('unknown, conflicting or already pending identities do not receive a completion receipt',async()=>{
 for(const options of [{},{matched:true,scopeUnresolved:true}]){
  const db=pool(options),output=await invoke(db,'data-deletion');
  assert.equal(output.status,503);
  assert.equal(JSON.parse(output.body).error,'instagram_compliance_identity_unresolved');
  assert.ok(db.calls.some(call=>call.sql==='ROLLBACK'));
  assert.equal(db.calls.some(call=>call.sql.startsWith('INSERT INTO v2_instagram_data_deletions')),false);
  assert.equal(db.calls.some(call=>call.sql.startsWith('DELETE FROM')),false);
 }
 assert.equal((await invoke(pool())).status,503);
});

test('old V2 deletion receipts are stable and historical pending or legacy-only deliveries are not reapplied',async()=>{
 for(const [prior,withDeletion,expected] of [
  [{v2_only:false,legacy_response:null},true,503],
  [{v2_only:false,legacy_response:{confirmation_code:'a'.repeat(32)}},false,503],
  [{v2_only:false,legacy_response:{confirmation_code:'a'.repeat(32)}},true,200],
 ]){
  const db=pool({matched:true,prior,withDeletion}),output=await invoke(db,'data-deletion');
  assert.equal(output.status,expected);
  if(expected===200)assert.equal(new URL(JSON.parse(output.body).url).pathname,'/api/instagram/data-deletion-status');
  assert.equal(db.calls.some(call=>/^(INSERT|DELETE|UPDATE)/.test(call.sql)),false);
 }
});

test('unavailable configuration or database fails locally, and invalid signatures do not touch storage',async()=>{
 const noConfig=pool();
 assert.equal((await invoke(noConfig,'deauthorize',null)).status,503);
 assert.equal(noConfig.calls.length,0);
 const failure=await invoke(pool({fail:true}));
 assert.equal(failure.status,503);
 assert.doesNotMatch(failure.body,/synthetic database/);
 const invalid=pool();
 const signed=signedRequest();
 assert.equal((await invoke(invalid,'deauthorize',config,(signed.startsWith('A')?'B':'A')+signed.slice(1))).status,400);
 assert.equal(invalid.calls.length,0);
});

test('publishing schema installs identity tombstones and the local archive',async()=>{
 const migrations=[],identityHash=createHash('sha256').update('instagram-meta-subject:17841405309211844').digest('hex');
 const db={async query(sql,args){migrations.push({sql,args});
  return sql.startsWith('SELECT user_id,instagram_user_id FROM v2_instagram_connections')
   ?{rowCount:1,rows:[{user_id:42,instagram_user_id:'17841405309211844'}]}:{rowCount:0,rows:[]};}};
 await ensurePublishingSchema(db);
 assert.ok(migrations.some(item=>item.sql.includes('CREATE TABLE IF NOT EXISTS v2_instagram_compliance_subjects')));
 assert.ok(migrations.some(item=>item.sql.includes('CREATE TABLE IF NOT EXISTS v2_instagram_legacy_deletion_status')));
 assert.ok(migrations.some(item=>item.sql.includes('INSERT INTO v2_instagram_compliance_subjects')&&item.args[1]===identityHash));
});

test('legacy receipt reads only the local hash and preserves pending, complete and unknown states',async()=>{
 const code='0123456789abcdef0123456789abcdef';
 for(const [rows,status,body] of [
  [[],404,{error:'not_found'}],
  [[{completed_at:null,scope_completed:true}],200,{status:'pending'}],
  [[{completed_at:new Date(),scope_completed:true}],200,{status:'completed'}],
 ]){
  const db={async query(sql,args){
   assert.match(sql,/v2_instagram_legacy_deletion_status/);
   assert.deepEqual(args,[deletionCodeHash(code)]);
   return {rows};
  }};
  const output=res();
  await serveInstagramDataDeletionStatus({method:'GET'},output,new URL('https://1ce.lol/privacy?deletion='+code),db);
  assert.equal(output.status,status);
  assert.deepEqual(JSON.parse(output.body),body);
 }
});
