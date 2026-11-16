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
function pool({matched=false}={}){
 const calls=[];const client={async query(sql,args){calls.push({sql,args});
  if(sql.includes('SELECT user_id,generation FROM v2_instagram_connections'))return{rowCount:matched?1:0,rows:matched?[{user_id:42,generation:'00000000-0000-4000-8000-000000000001'}]:[]};
  return{rowCount:1,rows:[]};},release(){}};
 return{calls,async query(sql,args){calls.push({sql,args});return{rowCount:matched?1:0,rows:matched?[{one:1}]:[]}},async connect(){return client}};
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

test('data deletion after deauthorization still recognizes V2 history and refuses a false success',async()=>{
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
 assert.equal(response.status,503);
 assert.deepEqual(JSON.parse(response.body),{error:'v2_data_deletion_contract_required'});
 assert.deepEqual(actions,['deauthorize','data-deletion']);
});

test('v1 data deletion is proxied unchanged; a v2 request fails closed without deleting data absent a contract',async()=>{
 const input=req('data-deletion'),db=pool(),response=res();
 await handleInstagramMetaCompliance(input.request,response,input.url,db,config,{http:legacyResponse('data-deletion')});
 assert.equal(response.status,200);
 assert.deepEqual(JSON.parse(response.body),{url:'https://1ce.lol/privacy?deletion=0123456789abcdef0123456789abcdef',confirmation_code:'0123456789abcdef0123456789abcdef'});
 const v2=pool({matched:true}),v2Response=res(),v2Input=req('data-deletion');
 await handleInstagramMetaCompliance(v2Input.request,v2Response,v2Input.url,v2,config,{http:legacyResponse('data-deletion')});
 assert.equal(v2Response.status,503);
 assert.deepEqual(JSON.parse(v2Response.body),{error:'v2_data_deletion_contract_required'});
 assert.equal(v2.calls.some(call=>/DELETE|UPDATE/.test(call.sql)),false);
 assert.match(v2.calls.find(call=>call.sql.includes('v2_instagram_compliance_subjects')).sql,/UNION ALL/);
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
