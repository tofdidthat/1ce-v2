import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash,createHmac} from 'node:crypto';
import {handleInstagramMetaCompliance,parseMetaSignedRequest} from '../dist/instagram-meta-compliance.js';
import {ensurePublishingSchema} from '../dist/publishing-schema.js';

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
function pool({matched=false,unmapped=false}={}){
 const calls=[],receipts=new Map(),deletions=new Map(),state={connected:matched,known:matched};const client={async query(sql,args){calls.push({sql,args});
  if(sql.startsWith('SELECT request_hash FROM v2_instagram_data_deletions'))return{rowCount:deletions.has(args[0])?1:0,rows:deletions.has(args[0])?[{}]:[]};
  if(sql.startsWith('SELECT 1 FROM v2_publication_jobs j WHERE j.instagram_generation'))return{rowCount:unmapped?1:0,rows:unmapped?[{}]:[]};
  if(sql.startsWith('INSERT INTO v2_instagram_data_deletions'))deletions.set(args[0],{owners:args[2]});
  if(sql.startsWith('SELECT user_id FROM v2_instagram_connections'))return{rowCount:state.known?1:0,rows:state.known?[{user_id:42}]:[]};
  if(sql.startsWith('SELECT legacy_response'))return{rowCount:receipts.has(args[0])?1:0,rows:receipts.has(args[0])?[receipts.get(args[0])]:[]};
  if(sql.startsWith('INSERT INTO v2_instagram_compliance_receipts'))receipts.set(args[0],{legacy_response:null});
  if(sql.startsWith('UPDATE v2_instagram_compliance_receipts'))receipts.get(args[0]).legacy_response=JSON.parse(args[1]);
  if(sql.includes('SELECT user_id,generation FROM v2_instagram_connections'))return{rowCount:state.connected?1:0,rows:state.connected?[{user_id:42,generation:'00000000-0000-4000-8000-000000000001'}]:[]};
  if(sql.startsWith('SELECT 1 FROM v2_instagram_connections'))return{rowCount:state.known?1:0,rows:state.known?[{one:1}]:[]};
  if(sql.startsWith('DELETE FROM v2_instagram_connections'))state.connected=false;
  return{rowCount:1,rows:[]};},release(){}};
 return{calls,state,query:client.query,async connect(){return client}};
}
function legacyResponse(action){return async(url,options)=>{
 const target=new URL(String(url));assert.equal(target.hostname,'autoshorts-nine.vercel.app');
 assert.equal(target.searchParams.get('action'),action);assert.equal(options.method,'POST');
 assert.equal(new URLSearchParams(String(options.body)).get('signed_request'),signedRequest());
 return action==='data-deletion'?Response.json({url:'https://1ce.lol/privacy?deletion=0123456789abcdef0123456789abcdef',confirmation_code:'0123456789abcdef0123456789abcdef'}):Response.json({success:true});
};}

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
 let forwarded=false;
 await handleInstagramMetaCompliance(input.request,output,input.url,db,config,{http:async()=>{forwarded=true;throw Error('Must not forward')}});
 assert.equal(output.status,400);assert.equal(db.calls.length,0);assert.equal(forwarded,false);
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
  const db=pool(),response=res();let forwarded=false;
  await handleInstagramMetaCompliance(request,response,new URL('https://api.invalid/api/instagram/meta-compliance'),db,config,
   {http:async()=>{forwarded=true;return Response.json({success:true})}});
  assert.equal(response.status,400);assert.equal(db.calls.length,0);assert.equal(forwarded,false);
 }
});

test('legacy success responses cannot echo extra provider data into public responses or receipts',async()=>{
 const input=req(),response=res(),db=pool();
 await handleInstagramMetaCompliance(input.request,response,input.url,db,config,
  {http:async()=>Response.json({success:true,access_token:'synthetic-private-extra'})});
 assert.equal(response.status,200);assert.deepEqual(JSON.parse(response.body),{success:true});
 assert.doesNotMatch(JSON.stringify(db.calls),/synthetic-private-extra/);
});

test('deauthorization revokes matched v2 tokens and fences queued work, then preserves the v1 callback',async()=>{
 const db=pool({matched:true}),input=req(),response=res();
 await handleInstagramMetaCompliance(input.request,response,input.url,db,config,{http:legacyResponse('deauthorize')});
 assert.equal(response.status,200);assert.deepEqual(JSON.parse(response.body),{success:true});
 assert.ok(db.calls.some(call=>call.sql==='DELETE FROM v2_instagram_connections WHERE user_id=$1 AND instagram_user_id=$2'));
 assert.ok(db.calls.some(call=>call.sql.includes('INSERT INTO v2_instagram_compliance_subjects')&&
  call.args[1]===createHash('sha256').update('instagram-meta-subject:17841405309211844').digest('hex')));
 assert.ok(db.calls.some(call=>call.sql.includes("state='needs_review'")));
 assert.ok(db.calls.some(call=>call.sql==='COMMIT'));
});

test('data deletion after deauthorization recognizes V2 history and returns a processing status URL',async()=>{
 const db=pool({matched:true}),actions=[];
 const http=async(url)=>{
  const action=new URL(String(url)).searchParams.get('action');actions.push(action);
  return action==='data-deletion'?Response.json({url:'https://1ce.lol/privacy?deletion=0123456789abcdef0123456789abcdef',
   confirmation_code:'0123456789abcdef0123456789abcdef'}):Response.json({success:true});
 };
 const revoke=req('deauthorize'),revoked=res();
 await handleInstagramMetaCompliance(revoke.request,revoked,revoke.url,db,config,{http});
 assert.equal(revoked.status,200);
 const deletion=req('data-deletion'),response=res();
 await handleInstagramMetaCompliance(deletion.request,response,deletion.url,db,config,{http});
 assert.equal(response.status,200);
 const data=JSON.parse(response.body);
 assert.equal(new URL(data.url).pathname,'/api/instagram/data-deletion-status');
 assert.match(data.confirmation_code,/^[a-f0-9]{32}$/);
 assert.ok(db.calls.some(call=>call.sql.startsWith('INSERT INTO v2_instagram_data_deletions')));
 assert.deepEqual(actions,['deauthorize','data-deletion']);
});

test('v1 deletion is proxied unchanged; V2 schedules only approved integration cleanup',async()=>{
 const input=req('data-deletion'),db=pool(),response=res();
 await handleInstagramMetaCompliance(input.request,response,input.url,db,config,{http:legacyResponse('data-deletion')});
 assert.equal(response.status,200);
 assert.deepEqual(JSON.parse(response.body),{url:'https://1ce.lol/privacy?deletion=0123456789abcdef0123456789abcdef',confirmation_code:'0123456789abcdef0123456789abcdef'});
 const v2=pool({matched:true}),v2Response=res(),v2Input=req('data-deletion');
 await handleInstagramMetaCompliance(v2Input.request,v2Response,v2Input.url,v2,config,{http:legacyResponse('data-deletion')});
 assert.equal(v2Response.status,200);
 assert.equal(new URL(JSON.parse(v2Response.body).url).pathname,'/api/instagram/data-deletion-status');
 assert.equal(v2.calls.some(call=>/DELETE FROM (account_users|library_)/.test(call.sql)),false);
 assert.ok(v2.calls.some(call=>call.sql.startsWith('DELETE FROM v2_instagram_connections')));
 assert.match(v2.calls.find(call=>call.sql.includes('v2_instagram_compliance_subjects')).sql,/UNION/);
});

test('publishing schema installs the compliance identity tombstone migration',async()=>{
 const migrations=[],identityHash=createHash('sha256').update('instagram-meta-subject:17841405309211844').digest('hex');
 const db={async query(sql,args){migrations.push({sql,args});
  return sql.startsWith('SELECT user_id,instagram_user_id FROM v2_instagram_connections')
   ?{rowCount:1,rows:[{user_id:42,instagram_user_id:'17841405309211844'}]}:{rowCount:0,rows:[]};}};
 await ensurePublishingSchema(db);
 assert.ok(migrations.some(item=>item.sql.includes('CREATE TABLE IF NOT EXISTS v2_instagram_compliance_subjects')));
 assert.ok(migrations.some(item=>item.sql.includes('INSERT INTO v2_instagram_compliance_subjects')&&item.args[1]===identityHash));
});

test('when V2 Meta config is unavailable, the signed callback still reaches V1 but V2 does not claim completion',async()=>{
 const input=req(),response=res();
 await handleInstagramMetaCompliance(input.request,response,input.url,pool(),null,{http:legacyResponse('deauthorize')});
 assert.equal(response.status,503);
 assert.deepEqual(JSON.parse(response.body),{error:'v2_compliance_unavailable'});
});

test('invalid signature never reaches v1 or changes v2 records',async()=>{
 const input=req('deauthorize',signedRequest().replace(/^./,'A'));
 const db=pool({matched:true}),response=res();let upstream=0;
 await handleInstagramMetaCompliance(input.request,response,input.url,db,config,{http:async()=>{upstream++;return Response.json({success:true})}});
 assert.equal(response.status,400);assert.equal(upstream,0);
 assert.equal(db.calls.some(call=>/DELETE|UPDATE/.test(call.sql)),false);
});

test('legacy callback outages return retryable server errors without forwarding provider payloads',async()=>{
 const input=req(),response=res();
 await handleInstagramMetaCompliance(input.request,response,input.url,pool(),config,{http:async()=>{throw Error('synthetic token in URL') }});
 assert.equal(response.status,503);assert.doesNotMatch(response.body,/synthetic/);
});

test('duplicate deauth delivery reuses its receipt and does not revoke a later connection',async()=>{
 const db=pool({matched:true});let upstream=0;
 const http=async()=>{upstream++;return Response.json({success:true})};
 const first=req(),a=res();await handleInstagramMetaCompliance(first.request,a,first.url,db,config,{http});
 assert.equal(a.status,200);assert.equal(db.state.connected,false);
 db.state.connected=true;
 const duplicate=req(),b=res();await handleInstagramMetaCompliance(duplicate.request,b,duplicate.url,db,config,{http});
 assert.equal(b.status,200);assert.equal(db.state.connected,true);assert.equal(upstream,1);
 assert.equal(a.body,b.body);
 assert.doesNotMatch(JSON.stringify(db.calls),new RegExp(signedRequest().replace(/\./g,'\\.')));
});

test('a v1 outage can retry delivery without repeating local revocation after reconnect',async()=>{
 const db=pool({matched:true});let upstream=0;
 const http=async()=>{if(++upstream===1)throw Error('synthetic unavailable');return Response.json({success:true})};
 const first=req(),a=res();await handleInstagramMetaCompliance(first.request,a,first.url,db,config,{http});
 assert.equal(a.status,503);assert.equal(db.state.connected,false);db.state.connected=true;
 const second=req(),b=res();await handleInstagramMetaCompliance(second.request,b,second.url,db,config,{http});
 assert.equal(b.status,200);assert.equal(upstream,2);assert.equal(db.state.connected,true);
});

test('duplicate V2 deletion keeps its receipt and forwards v1 only once',async()=>{
 const db=pool({matched:true});let upstream=0;
 const http=async(...args)=>{upstream++;return legacyResponse('data-deletion')(...args)};
 for(let index=0;index<2;index++){
  const input=req('data-deletion'),output=res();await handleInstagramMetaCompliance(input.request,output,input.url,db,config,{http});
  assert.equal(output.status,200);assert.match(JSON.parse(output.body).confirmation_code,/^[a-f0-9]{32}$/);
  if(index===0)db.state.connected=true; // A completed cleanup may later reconnect.
 }
 assert.equal(upstream,1);assert.equal(db.state.connected,true);
 assert.equal(db.calls.filter(call=>call.sql.startsWith('INSERT INTO v2_instagram_data_deletions')).length,1);
});

test('unmapped pre-migration V2 history cannot be falsely acknowledged as v1-only deletion',async()=>{
 const db=pool({unmapped:true}),input=req('data-deletion'),output=res();let forwards=0;
 await handleInstagramMetaCompliance(input.request,output,input.url,db,config,{http:async(...args)=>{
  forwards++;return legacyResponse('data-deletion')(...args);
 }});
 assert.equal(forwards,1);assert.equal(output.status,503);
 assert.deepEqual(JSON.parse(output.body),{error:'instagram_deletion_identity_unresolved'});
 assert.equal(db.calls.some(call=>call.sql.startsWith('INSERT INTO v2_instagram_data_deletions')),false);
});
