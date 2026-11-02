import { createServer } from 'node:http';
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import { handleLibraryFiles } from './library-files.js';
import { handlePublicProfiles } from './public-profiles.js';
const scrypt=promisify(scryptCallback);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:true}:undefined});
const origin=process.env.WEB_ORIGIN || 'http://localhost:5173';
const cookieName='onece_v2_session';
const hash=s=>createHash('sha256').update(s).digest('hex');
const json=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));};
const parseCookies=s=>Object.fromEntries((s||'').split(';').map(x=>x.trim().split('=').slice(0,2)).filter(x=>x.length===2));
const attempts=new Map();
function rateLimited(ip){const now=Date.now();const a=(attempts.get(ip)||[]).filter(t=>now-t<15*60*1000);a.push(now);attempts.set(ip,a);if(attempts.size>10000)for(const [k,v] of attempts)if(v.every(t=>now-t>15*60*1000))attempts.delete(k);return a.length>20;}
async function verify(password,stored){const p=(stored||'').split('$');if(p.length!==3||p[0]!=='scrypt'||!/^[a-f0-9]{32}$/i.test(p[1])||!/^[a-f0-9]{128}$/i.test(p[2]))return false;const expected=Buffer.from(p[2],'hex');const derived=await scrypt(password,Buffer.from(p[1],'hex'),expected.length,{N:16384,r:8,p:1});return timingSafeEqual(derived,expected);}
function cookie(token,maxAge){return cookieName+'='+token+'; HttpOnly; Secure; SameSite=None; Path=/; Max-Age='+maxAge;}
async function currentUser(req){const token=parseCookies(req.headers.cookie)[cookieName];if(!token||!/^[a-f0-9]{64}$/.test(token))return null;const q=await pool.query('SELECT u.id,u.email,u.name,u.picture FROM account_sessions s JOIN account_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',[hash(token)]);return q.rows[0]||null;}

const googleStateCookie='onece_v2_google_state';
const shaBase64=s=>createHash('sha256').update(s).digest('base64url');
const validCode=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{43}$/.test(s);
const googleConfig=()=>({clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,redirectUri:process.env.GOOGLE_REDIRECT_URI});
const redirect=(res,url,headers={})=>{res.writeHead(302,{'Location':url,'Cache-Control':'no-store',...headers});res.end();};
const googleError=res=>redirect(res,origin+'/app?login=error',{'Set-Cookie':googleStateCookie+'=; HttpOnly; Secure; SameSite=Lax; Path=/auth/google; Max-Age=0'});
async function requestGoogleUser(code,config){
 const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:config.redirectUri,grant_type:'authorization_code'}),signal:AbortSignal.timeout(10000)});
 if(!tokenResponse.ok)throw new Error('Google token exchange failed');
 const token=await tokenResponse.json();
 if(typeof token.access_token!=='string')throw new Error('Google access token missing');
 const userResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(10000)});
 if(!userResponse.ok)throw new Error('Google userinfo failed');
 const user=await userResponse.json();
 if(typeof user.sub!=='string'||!user.sub||typeof user.email!=='string'||user.email_verified!==true)throw new Error('Google identity not verified');
 return user;
}
async function linkGoogleUser(client,profile){
 const email=profile.email.trim().toLowerCase();
 if(!email||email.length>254)throw new Error('Invalid Google email');
 const byGoogle=await client.query('SELECT id,email,google_id,email_verified FROM account_users WHERE google_id=$1 FOR UPDATE',[profile.sub]);
 if(byGoogle.rows.length){
  const existing=byGoogle.rows[0];
  const collision=await client.query('SELECT id FROM account_users WHERE lower(email)=$1 AND id<>$2',[email,existing.id]);
  if(collision.rowCount)throw new Error('Google email collision');
  await client.query('UPDATE account_users SET email=$1,name=COALESCE($2,name),picture=COALESCE($3,picture),email_verified=true,updated_at=now() WHERE id=$4',[email,profile.name||null,profile.picture||null,existing.id]);
  return existing.id;
 }
 const byEmail=await client.query('SELECT id,google_id,email_verified FROM account_users WHERE lower(email)=$1 FOR UPDATE',[email]);
 if(byEmail.rows.length){
  const existing=byEmail.rows[0];
  if(existing.google_id&&existing.google_id!==profile.sub)throw new Error('Email already linked to another Google identity');
  if(!existing.email_verified){
   await client.query('DELETE FROM account_sessions WHERE user_id=$1',[existing.id]);
   // Additional verification/reset token tables must be cleared if introduced later.
  }
  await client.query('UPDATE account_users SET google_id=$1,password_hash=CASE WHEN email_verified THEN password_hash ELSE NULL END,email_verified=true,name=COALESCE($2,name),picture=COALESCE($3,picture),updated_at=now() WHERE id=$4',[profile.sub,profile.name||null,profile.picture||null,existing.id]);
  return existing.id;
 }
 const created=await client.query('INSERT INTO account_users(google_id,email,email_verified,name,picture) VALUES($1,$2,true,$3,$4) RETURNING id',[profile.sub,email,profile.name||null,profile.picture||null]);
 return created.rows[0].id;
}

const server=createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const allowed=req.headers.origin===origin;
 if(allowed){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');}
 if(req.method==='OPTIONS'){res.writeHead(allowed?204:403,{'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end();}
 if(pathname==='/health'&&req.method==='GET')return json(res,200,{ok:true,service:'1ce-v2-api'});
 if(pathname==='/health/db'&&req.method==='GET'){
  try{await pool.query('SELECT 1');return json(res,200,{ok:true,database:'connected'});}
  catch(err){console.error('v2 database health check failed',err?.message);return json(res,503,{ok:false,database:'unavailable'});}
 }
 if(!allowed && req.headers.origin)return json(res,403,{error:'Origin not allowed'});
 try{

  if(await handlePublicProfiles(req,res,pathname,pool,currentUser))return;
  if(await handleLibraryFiles(req,res,pathname,pool,currentUser))return;

  if(pathname==='/auth/google'&&req.method==='GET'){
   const config=googleConfig();
   if(!config.clientId||!config.clientSecret||!config.redirectUri)return json(res,503,{error:'Google login is not configured'});
   const challenge=new URL(req.url,'http://localhost').searchParams.get('challenge');
   if(!validCode(challenge))return json(res,400,{error:'Invalid challenge'});
   const state=randomBytes(32).toString('base64url');
   await pool.query('INSERT INTO account_google_login_attempts(state_hash,verifier_challenge) VALUES($1,$2)',[hash(state),shaBase64(challenge)]);
   const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
   for(const [k,v] of Object.entries({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:'openid email profile',state,access_type:'online',prompt:'select_account'}))url.searchParams.set(k,v);
   return redirect(res,url.toString(),{'Set-Cookie':googleStateCookie+'='+state+'; HttpOnly; Secure; SameSite=Lax; Path=/auth/google; Max-Age=600'});
  }
  if(pathname==='/auth/google/callback'&&req.method==='GET'){
   const params=new URL(req.url,'http://localhost').searchParams;
   const state=params.get('state'),code=params.get('code'),cookieState=parseCookies(req.headers.cookie)[googleStateCookie];
   if(!validCode(state)||!validCode(cookieState)||!code||code.length>4096||!timingSafeEqual(Buffer.from(state),Buffer.from(cookieState)))return googleError(res);
   const client=await pool.connect();
   let loginCode;
   try{
    await client.query('BEGIN');
    const transaction=await client.query('UPDATE account_google_login_attempts SET callback_used_at=now() WHERE state_hash=$1 AND callback_used_at IS NULL AND expires_at>now() RETURNING id',[hash(state)]);
    if(!transaction.rowCount){await client.query('ROLLBACK');return googleError(res);}
    await client.query('COMMIT');
    const profile=await requestGoogleUser(code,googleConfig());
    await client.query('BEGIN');
    const userId=await linkGoogleUser(client,profile);
    loginCode=randomBytes(32).toString('base64url');
    await client.query("UPDATE account_google_login_attempts SET user_id=$1,exchange_hash=$2,exchange_expires_at=now()+interval '5 minutes' WHERE id=$3",[userId,hash(loginCode),transaction.rows[0].id]);
    await client.query('COMMIT');
   }catch(err){
    try{await client.query('ROLLBACK');}catch{}
    console.error('Google callback failed:',err?.message);
    return googleError(res);
   }finally{client.release();}
   return redirect(res,origin+'/app?login_code='+encodeURIComponent(loginCode),{'Set-Cookie':googleStateCookie+'=; HttpOnly; Secure; SameSite=Lax; Path=/auth/google; Max-Age=0'});
  }
  if(pathname==='/auth/google/exchange'&&req.method==='POST'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)return json(res,413,{error:'Request too large'});}
   let data;try{data=JSON.parse(body)}catch{return json(res,400,{error:'Invalid request'});}
   if(!validCode(data.loginCode)||!validCode(data.verifier))return json(res,400,{error:'Invalid exchange'});
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const result=await client.query('SELECT id,user_id,verifier_challenge FROM account_google_login_attempts WHERE exchange_hash=$1 AND callback_used_at IS NOT NULL AND exchanged_at IS NULL AND exchange_expires_at>now() AND user_id IS NOT NULL FOR UPDATE',[hash(data.loginCode)]);
    const attempt=result.rows[0];
    if(!attempt||!timingSafeEqual(Buffer.from(attempt.verifier_challenge),Buffer.from(shaBase64(shaBase64(data.verifier))))){await client.query('ROLLBACK');return json(res,400,{error:'Invalid exchange'});}
    const token=randomBytes(32).toString('hex');
    await client.query("INSERT INTO account_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '7 days')",[attempt.user_id,hash(token)]);
    await client.query('UPDATE account_google_login_attempts SET exchanged_at=now() WHERE id=$1',[attempt.id]);
    await client.query('COMMIT');
    return json(res,200,{ok:true},{'Set-Cookie':cookie(token,604800)});
   }catch(err){try{await client.query('ROLLBACK');}catch{}throw err;}finally{client.release();}
  }

  if(pathname==='/auth/me'&&req.method==='GET'){const user=await currentUser(req);return user?json(res,200,{user}):json(res,401,{error:'Not authenticated'});}
  if(pathname==='/auth/logout'&&req.method==='POST'){const token=parseCookies(req.headers.cookie)[cookieName];if(token)await pool.query('DELETE FROM account_sessions WHERE token_hash=$1',[hash(token)]);return json(res,200,{ok:true},{'Set-Cookie':cookie('',0)});}
  if(pathname==='/auth/login'&&req.method==='POST'){
   if(rateLimited(req.socket.remoteAddress||'unknown'))return json(res,429,{error:'Too many attempts. Please try later.'});
   let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)return json(res,413,{error:'Request too large'});}
   let data;try{data=JSON.parse(body)}catch{return json(res,400,{error:'Invalid request'})}
   const email=String(data.email||'').trim().toLowerCase();const password=data.password;
   if(email.length>254||!email.includes('@')||typeof password!=='string'||password.length>1024||!password)return json(res,400,{error:'Invalid email or password'});
   const q=await pool.query('SELECT id,email,name,picture,password_hash,email_verified FROM account_users WHERE lower(email)=$1 LIMIT 1',[email]);
   const user=q.rows[0];if(!user||!await verify(password,user.password_hash))return json(res,401,{error:'Invalid email or password'});
   if(!user.email_verified)return json(res,403,{error:'Please verify your email before logging in'});
   const token=randomBytes(32).toString('hex');await pool.query("INSERT INTO account_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '7 days')",[user.id,hash(token)]);
   return json(res,200,{user:{id:user.id,email:user.email,name:user.name,picture:user.picture}},{'Set-Cookie':cookie(token,604800)});
  }
  return json(res,404,{error:'Not found'});
 }catch(err){console.error('v2 api error',err?.message);return json(res,500,{error:'Service unavailable'});}
});
server.listen(Number(process.env.PORT||3001),()=>console.log('1CE v2 API listening'));
