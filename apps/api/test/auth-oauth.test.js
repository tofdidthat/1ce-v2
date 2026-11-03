import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,scryptSync} from 'node:crypto';
import {Readable} from 'node:stream';
import {apiServer,apiPool} from '../src/server.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const shaBase64=value=>createHash('sha256').update(value).digest('base64url');
const salt=Buffer.alloc(16,7);
const passwordHash='scrypt$'+salt.toString('hex')+'$'+scryptSync('correct-secret',salt,64,{N:16384,r:8,p:1}).toString('hex');

function fixture(){
 const user={id:42,email:'producer@example.test',name:'Producer',picture:null,username:'producer',
  password_hash:passwordHash,email_verified:true,google_id:'google-sub-42'};
 const sessions=new Map(),attempts=new Map(),queries=[],googleFetches=[],rates=new Map();
 let nextAttempt=1;
 const db={user,sessions,attempts,queries,googleFetches,rates,async query(sql,args=[]){
  queries.push({sql,args});
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rowCount:0,rows:[]};
  if(sql.startsWith('INSERT INTO v2_api_rate_limits')){
   const key=args[0]+':'+args[1],hits=(rates.get(key)||0)+1;
   rates.set(key,hits);return {rowCount:1,rows:[{hits}]};
  }
  if(sql==='SELECT 1')return {rowCount:1,rows:[{'?column?':1}]};
  if(sql.includes('FROM account_sessions s JOIN account_users u')){
   const s=sessions.get(args[0]);
   const active=s&&s.expiresAt==='mock-future';
   return {rowCount:active?1:0,rows:active?[{id:user.id,email:user.email,name:user.name,picture:user.picture,username:user.username,has_avatar:false,avatar_updated_at:null}]:[]};
  }
  if(sql.startsWith('SELECT id,email,name,picture,password_hash,email_verified FROM account_users')){
   return {rowCount:args[0]===user.email?1:0,rows:args[0]===user.email?[user]:[]};
  }
  if(sql.startsWith('INSERT INTO account_sessions(')){
   sessions.set(args[1],{userId:args[0],expiresAt:'mock-future'});
   return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('DELETE FROM account_sessions WHERE token_hash=$1')){
   const had=sessions.delete(args[0]);return {rowCount:had?1:0,rows:[]};
  }
  if(sql.startsWith('INSERT INTO account_google_login_attempts(')){
   const a={id:nextAttempt++,stateHash:args[0],verifierChallenge:args[1],callbackUsed:false,exchanged:false,callbackExpired:false,exchangeExpired:false};
   attempts.set(a.id,a);return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('UPDATE account_google_login_attempts SET callback_used_at=')){
   const a=[...attempts.values()].find(a=>a.stateHash===args[0]&&!a.callbackUsed&&!a.callbackExpired);
   if(a)a.callbackUsed=true;
   return {rowCount:a?1:0,rows:a?[{id:a.id}]:[]};
  }
  if(sql.startsWith('SELECT id,email,google_id,email_verified FROM account_users WHERE google_id=$1 FOR UPDATE')){
   return {rowCount:args[0]===user.google_id?1:0,rows:args[0]===user.google_id?[user]:[]};
  }
  if(sql.startsWith('SELECT id FROM account_users WHERE lower(email)=$1 AND id<>$2'))return {rowCount:0,rows:[]};
  if(sql.startsWith('UPDATE account_users SET email='))return {rowCount:1,rows:[]};
  if(sql.startsWith('UPDATE account_google_login_attempts SET user_id=$1,')){
   const a=attempts.get(args[2]);
   if(!a)throw Error('No attempt to link');
   a.userId=args[0];a.exchangeHash=args[1];return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('SELECT id,user_id,verifier_challenge FROM account_google_login_attempts WHERE exchange_hash=$1')){
   const a=[...attempts.values()].find(a=>a.exchangeHash===args[0]&&a.callbackUsed&&!a.exchanged&&!a.exchangeExpired);
   return {rowCount:a?1:0,rows:a?[{id:a.id,user_id:a.userId,verifier_challenge:a.verifierChallenge}]:[]};
  }
  if(sql.startsWith('UPDATE account_google_login_attempts SET exchanged_at=')){
   const a=attempts.get(args[0]);if(a)a.exchanged=true;
   return {rowCount:a?1:0,rows:[]};
  }
  throw Error('Unexpected auth query: '+sql);
 }};
 return db;
}

async function send(method,path,body,headers={},remoteAddress='198.51.100.72'){
 const chunks=body===undefined?[]:[Buffer.from(typeof body==='string'?body:JSON.stringify(body))];
 const req=Readable.from(chunks);
 req.method=method;req.url=path;req.headers=headers;req.socket={remoteAddress};
 return new Promise((resolve,reject)=>{
  const response={status:0,headers:{},chunks:[],
   setHeader(name,value){this.headers[name]=value;},
   writeHead(status,headers={}){this.status=status;Object.assign(this.headers,headers);},
   write(value){this.chunks.push(Buffer.from(value));},
   end(value){
    if(value)this.chunks.push(Buffer.from(value));
    const text=Buffer.concat(this.chunks).toString('utf8');
    let json=null;if(text){try{json=JSON.parse(text)}catch{return reject(Error('Non-JSON response: '+text));}}
    resolve({status:this.status,headers:this.headers,json,text});
   }};
  try{apiServer.emit('request',req,response);}catch(err){reject(err);}
 });
}
const cookieValue=(value,name)=>{
 const found=String(value||'').match(new RegExp('(?:^|; )'+name+'=([^;]*)'));
 return found?.[1]||null;
};

const originalQuery=apiPool.query,originalConnect=apiPool.connect,originalFetch=globalThis.fetch;
const envKeys=['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REDIRECT_URI'];
const originalEnv=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
let h;
test.beforeEach(()=>{
 h=fixture();
 apiPool.query=(...args)=>h.query(...args);
 apiPool.connect=async()=>({query:(...args)=>h.query(...args),release(){}});
 process.env.GOOGLE_CLIENT_ID='test-client-id';
 process.env.GOOGLE_CLIENT_SECRET='mock-not-real';
 process.env.GOOGLE_REDIRECT_URI='https://example.test/auth/google/callback';
 globalThis.fetch=async(url)=>{
  h.googleFetches.push(String(url));
  return {ok:true,json:async()=>String(url).includes('/token')?{access_token:'mock-only-access-token'}:
   {sub:h.user.google_id,email:h.user.email,email_verified:true,name:h.user.name,picture:null}};
 };
});
test.after(()=>{
 apiPool.query=originalQuery;apiPool.connect=originalConnect;globalThis.fetch=originalFetch;
 for(const key of envKeys){if(originalEnv[key]===undefined)delete process.env[key];else process.env[key]=originalEnv[key];}
});

test('unauthenticated, malformed and unknown sessions cannot read private identity',async()=>{
 assert.equal((await send('GET','/auth/me')).status,401);
 assert.equal((await send('GET','/auth/me',undefined,{cookie:'onece_v2_session=not-a-token'})).status,401);
 assert.equal((await send('GET','/auth/me',undefined,{cookie:'onece_v2_session='+'a'.repeat(64)})).status,401);
 assert.equal(h.sessions.size,0);
});

test('valid email password login creates only a hashed seven-day session; logout revokes it',async()=>{
 const res=await send('POST','/auth/login',{email:' Producer@Example.Test ',password:'correct-secret'});
 assert.equal(res.status,200);
 assert.equal(res.json.user.id,42);
 const cookie=res.headers['Set-Cookie'];
 assert.match(cookie,/^onece_v2_session=[a-f0-9]{64}; HttpOnly; Secure; SameSite=None; Path=\/; Max-Age=604800$/);
 const token=cookieValue(cookie,'onece_v2_session');
 assert.equal(h.sessions.has(hash(token)),true);
 assert.equal(h.sessions.has(token),false);
 assert.equal((await send('GET','/auth/me',undefined,{cookie:'onece_v2_session='+token})).json.user.id,42);
 const logout=await send('POST','/auth/logout',undefined,{cookie:'onece_v2_session='+token});
 assert.equal(logout.status,200);
 assert.match(logout.headers['Set-Cookie'],/Max-Age=0$/);
 assert.equal(h.sessions.size,0);
 assert.equal((await send('GET','/auth/me',undefined,{cookie:'onece_v2_session='+token})).status,401);
});

test('wrong password, malformed JSON, invalid identity and unverified email never create a session',async()=>{
 assert.equal((await send('POST','/auth/login','{not-json')).status,400);
 assert.equal((await send('POST','/auth/login',{email:'not-an-email',password:'abc'})).status,400);
 assert.equal((await send('POST','/auth/login',{email:h.user.email,password:'wrong-secret'})).status,401);
 assert.equal((await send('POST','/auth/login',{email:'missing@example.test',password:'wrong-secret'})).status,401);
 h.user.email_verified=false;
 assert.equal((await send('POST','/auth/login',{email:h.user.email,password:'correct-secret'})).status,403);
 assert.equal(h.sessions.size,0);
});

test('login rate limiting returns 429 after 20 attempts for the same account across sockets',async()=>{
 for(let i=0;i<20;i++){
  const res=await send('POST','/auth/login',{email:'bad',password:'x'}, {},i%2?'192.0.2.251':'192.0.2.252');
  assert.equal(res.status,400);
 }
 const blocked=await send('POST','/auth/login',{email:'bad',password:'x'}, {},'192.0.2.251');
 assert.equal(blocked.status,429);
 assert.equal(blocked.json.error,'Too many attempts. Please try later.');
});

test('Google login requires a valid client challenge and binds random state to HttpOnly cookie',async()=>{
 const invalid=await send('GET','/auth/google?challenge=short');
 assert.equal(invalid.status,400);assert.equal(h.attempts.size,0);
 const verifier=Buffer.alloc(32,11).toString('base64url');
 const challenge=shaBase64(verifier);
 const start=await send('GET','/auth/google?challenge='+challenge);
 assert.equal(start.status,302);
 const location=new URL(start.headers.Location);
 assert.equal(location.host,'accounts.google.com');
 assert.equal(location.searchParams.get('client_id'),'test-client-id');
 assert.equal(location.searchParams.get('response_type'),'code');
 const state=location.searchParams.get('state');
 assert.match(state,/^[A-Za-z0-9_-]{43}$/);
 assert.match(start.headers['Set-Cookie'],/^onece_v2_google_state=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Lax; Path=\/auth\/google; Max-Age=600$/);
 const attempt=[...h.attempts.values()][0];
 assert.equal(attempt.stateHash,hash(state));
 assert.equal(attempt.verifierChallenge,shaBase64(challenge));
 assert.equal(h.googleFetches.length,0);
});

test('Google callback rejects missing/mismatched state before any token request',async()=>{
 const state=Buffer.alloc(32,8).toString('base64url');
 const wrong=Buffer.alloc(32,9).toString('base64url');
 const result=await send('GET','/auth/google/callback?state='+state+'&code=mock-code',undefined,{cookie:'onece_v2_google_state='+wrong});
 assert.equal(result.status,302);
 assert.match(result.headers.Location,/\/app\?login=error$/);
 assert.equal(h.googleFetches.length,0);
});

test('Google callback and verifier exchange are single-use; wrong verifier and replay cannot open a session',async()=>{
 const verifier=Buffer.alloc(32,17).toString('base64url');
 const challenge=shaBase64(verifier);
 const start=await send('GET','/auth/google?challenge='+challenge);
 const state=new URL(start.headers.Location).searchParams.get('state');
 const boundCookie='onece_v2_google_state='+state;
 const callback=await send('GET','/auth/google/callback?state='+state+'&code=mock-code',undefined,{cookie:boundCookie});
 assert.equal(callback.status,302);
 const loginCode=new URL(callback.headers.Location).searchParams.get('login_code');
 assert.match(loginCode,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(h.googleFetches.length,2);
 assert.equal(h.sessions.size,0);
 const reusedCallback=await send('GET','/auth/google/callback?state='+state+'&code=mock-code',undefined,{cookie:boundCookie});
 assert.equal(reusedCallback.status,302);
 assert.match(reusedCallback.headers.Location,/\/app\?login=error$/);
 assert.equal(h.googleFetches.length,2);
 const wrong=Buffer.alloc(32,18).toString('base64url');
 assert.equal((await send('POST','/auth/google/exchange',{loginCode,verifier:wrong})).status,400);
 assert.equal(h.sessions.size,0);
 const good=await send('POST','/auth/google/exchange',{loginCode,verifier});
 assert.equal(good.status,200);assert.equal(good.json.ok,true);
 assert.match(good.headers['Set-Cookie'],/^onece_v2_session=[a-f0-9]{64}; HttpOnly; Secure/);
 assert.equal(h.sessions.size,1);
 assert.equal((await send('POST','/auth/google/exchange',{loginCode,verifier})).status,400);
 assert.equal(h.sessions.size,1);
 assert.equal([...h.attempts.values()][0].exchanged,true);
});

test('Google exchange rejects malformed codes without reaching database',async()=>{
 const res=await send('POST','/auth/google/exchange',{loginCode:'bad',verifier:'bad'});
 assert.equal(res.status,400);
 assert.equal(h.attempts.size,0);
 assert.equal(h.sessions.size,0);
});

test('untrusted browser Origin is denied before auth/database work',async()=>{
 const denied=await send('GET','/auth/me',undefined,{origin:'https://untrusted.example.test'});
 assert.equal(denied.status,403);
 assert.equal(denied.json.error,'Origin not allowed');
 assert.equal(h.queries.length,0);
});

test('Google token/userinfo verification failure never creates a session or redeemable login code',async()=>{
 const verifier=Buffer.alloc(32,21).toString('base64url');
 const challenge=shaBase64(verifier);
 const start=await send('GET','/auth/google?challenge='+challenge);
 const state=new URL(start.headers.Location).searchParams.get('state');
 globalThis.fetch=async url=>{
  h.googleFetches.push(String(url));
  return {ok:true,json:async()=>String(url).includes('/token')?
   {access_token:'only-a-fake-token'}:
   {sub:h.user.google_id,email:h.user.email,email_verified:false}};
 };
 const failed=await send('GET','/auth/google/callback?state='+state+'&code=mock-code',undefined,{cookie:'onece_v2_google_state='+state});
 assert.equal(failed.status,302);
 assert.match(failed.headers.Location,/\/app\?login=error$/);
 assert.equal(h.sessions.size,0);
 assert.equal([...h.attempts.values()][0].exchanged,false);
 assert.equal((await send('GET','/auth/google/callback?state='+state+'&code=mock-code',undefined,{cookie:'onece_v2_google_state='+state})).status,302);
 assert.equal(h.googleFetches.length,2);
});

test('imported API request handler does not bind a production port during tests',()=>{
 assert.equal(apiServer.listening,false);
});


test('expired session is denied even when its hashed token remains stored',async()=>{
 const login=await send('POST','/auth/login',{email:h.user.email,password:'correct-secret'});
 assert.equal(login.status,200);
 const token=cookieValue(login.headers['Set-Cookie'],'onece_v2_session');
 const record=h.sessions.get(hash(token));
 assert.ok(record);
 record.expiresAt='mock-expired';
 const me=await send('GET','/auth/me',undefined,{cookie:'onece_v2_session='+token});
 assert.equal(me.status,401);
 assert.equal(me.json.error,'Not authenticated');
 assert.equal(h.sessions.has(hash(token)),true); // Rejected by expires_at query, not deleted by GET.
 assert.equal(h.queries.some(x=>x.sql.includes('s.expires_at>now()')),true);
});

test('auth rejects oversized payloads and malformed OAuth JSON without creating sessions',async()=>{
 assert.equal((await send('POST','/auth/login','x'.repeat(8200))).status,413);
 assert.equal((await send('POST','/auth/google/exchange','x'.repeat(8200))).status,413);
 assert.equal((await send('POST','/auth/google/exchange','{"loginCode":')).status,400);
 assert.equal(h.sessions.size,0);
});

test('expired Google callback state rejects before token exchange',async()=>{
 const verifier=Buffer.alloc(32,31).toString('base64url');
 const begin=await send('GET','/auth/google?challenge='+shaBase64(verifier));
 assert.equal(begin.status,302);
 const state=new URL(begin.headers.Location).searchParams.get('state');
 const attempt=[...h.attempts.values()][0];
 attempt.callbackExpired=true;
 const callback=await send('GET','/auth/google/callback?state='+state+'&code=mock-code',undefined,{cookie:'onece_v2_google_state='+state});
 assert.equal(callback.status,302);
 assert.match(callback.headers.Location,/\/app\?login=error$/);
 assert.equal(h.googleFetches.length,0);
 assert.equal(h.sessions.size,0);
 assert.equal(h.queries.some(x=>x.sql.includes('callback_used_at IS NULL AND expires_at>now()')),true);
});

test('expired Google exchange authorization cannot create a session',async()=>{
 const verifier=Buffer.alloc(32,32).toString('base64url');
 const begin=await send('GET','/auth/google?challenge='+shaBase64(verifier));
 const state=new URL(begin.headers.Location).searchParams.get('state');
 const callback=await send('GET','/auth/google/callback?state='+state+'&code=mock-code',undefined,{cookie:'onece_v2_google_state='+state});
 const loginCode=new URL(callback.headers.Location).searchParams.get('login_code');
 assert.ok(loginCode);
 const attempt=[...h.attempts.values()][0];
 attempt.exchangeExpired=true;
 assert.equal((await send('POST','/auth/google/exchange',{loginCode,verifier})).status,400);
 assert.equal(h.sessions.size,0);
 assert.equal(attempt.exchanged,false);
 assert.equal(h.queries.some(x=>x.sql.includes('exchange_expires_at>now()')),true);
});

test('health endpoints are isolated from authentication; DB health is verified through the fixture',async()=>{
 const health=await send('GET','/health');
 assert.equal(health.status,200);
 assert.equal(health.json.ok,true);
 assert.equal(health.json.service,'1ce-v2-api');
 assert.equal(health.headers['Cache-Control'],'no-store');
 const db=await send('GET','/health/db');
 assert.equal(db.status,200);
 assert.deepEqual(db.json,{ok:true,database:'connected'});
});
