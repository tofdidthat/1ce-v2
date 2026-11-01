import { createServer } from 'node:http';
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
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
const server=createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const allowed=req.headers.origin===origin;
 if(allowed){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');}
 if(req.method==='OPTIONS'){res.writeHead(allowed?204:403,{'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end();}
 if(pathname==='/health'&&req.method==='GET')return json(res,200,{ok:true,service:'1ce-v2-api'});
 if(!allowed && req.headers.origin)return json(res,403,{error:'Origin not allowed'});
 try{
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
