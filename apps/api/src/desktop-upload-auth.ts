import {createHash,randomBytes} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {QueryableV2} from '../../../packages/shared/contracts.js';
import {rateLimitExceeded} from './api-rate-limits.js';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const randomToken=()=>randomBytes(32).toString('base64url');
const validCode=(value:unknown):value is string=>
 typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const bearer=(req:IncomingMessage)=>/^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.headers.authorization||'')?.[1];
const send=(res:ServerResponse,status:number,data:unknown)=>{
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
 res.end(JSON.stringify(data));
};

async function readBody(req:IncomingMessage):Promise<Record<string,unknown>|null>{
 if(req.headers['content-type']?.split(';')[0]!=='application/json')return null;
 let body='';
 for await(const chunk of req){
  body+=chunk;
  if(body.length>2048)return null;
 }
 try{
  const value:unknown=JSON.parse(body);
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
 }catch{return null;}
}

export async function handleDesktopUploadAuth(
 req:IncomingMessage,res:ServerResponse,pathname:string,pool:QueryableV2,webOrigin:string,sessionHash?:string
):Promise<boolean>{
 const authorize=pathname==='/auth/desktop-upload/authorize';
 const exchange=pathname==='/auth/desktop-upload/token';
 const revoke=pathname==='/auth/desktop-upload/revoke';
 if(!authorize&&!exchange&&!revoke)return false;
 if(req.method!=='POST'){send(res,405,{error:'Method not allowed'});return true;}
 if(authorize?req.headers.origin!==webOrigin:Boolean(req.headers.origin||req.headers.cookie)){
  send(res,403,{error:'Origin not allowed'});return true;
 }
 if(revoke){
  const token=bearer(req);
  if(!token){send(res,401,{error:'Invalid desktop token'});return true;}
  await pool.query('DELETE FROM account_desktop_upload_grants WHERE token_hash=$1',[hash(token)]);
  send(res,200,{ok:true});return true;
 }
 const data=await readBody(req);
 if(authorize){
  if(!sessionHash){send(res,401,{error:'Not authenticated'});return true;}
  const challenge=data?.codeChallenge;
  const accountId=data?.accountId;
  if(!validCode(challenge)||typeof accountId!=='number'||!Number.isSafeInteger(accountId)||accountId<1||
   accountId>2147483647){
   send(res,400,{error:'Invalid authorization request'});return true;
  }
  const session=await pool.query(`SELECT s.id,s.user_id,u.web_beta FROM account_sessions s
   JOIN account_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`,[sessionHash]);
  const active=session.rows[0];
  if(!active){send(res,401,{error:'Not authenticated'});return true;}
  if(active.user_id!==accountId){send(res,409,{error:'Account changed. Reload before authorizing.'});return true;}
  if(active.web_beta){send(res,403,{error:'Desktop upload is unavailable in the web beta'});return true;}
  if(await rateLimitExceeded(pool,'desktop-upload-consent',accountId,30,60)){
   send(res,429,{error:'Too many authorization requests'});return true;
  }
  await pool.query(`DELETE FROM account_desktop_upload_grants WHERE session_id=$1
   AND COALESCE(token_expires_at,code_expires_at)<=now()`,[active.id]);
  const code=randomToken();
  const inserted=await pool.query(`INSERT INTO account_desktop_upload_grants(code_hash,session_id,challenge)
   SELECT $1,s.id,$3 FROM account_sessions s JOIN account_users u ON u.id=s.user_id
   WHERE s.id=$2 AND s.expires_at>now() AND NOT u.web_beta RETURNING session_id`,
   [hash(code),active.id,challenge]);
  if(!inserted.rowCount){send(res,401,{error:'Not authenticated'});return true;}
  send(res,200,{code});return true;
 }
 const code=data?.code;
 const verifier=data?.codeVerifier;
 if(!validCode(code)||typeof verifier!=='string'||!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)){
  send(res,400,{error:'Invalid token exchange'});return true;
 }
 const token=randomToken();
 const expiresIn=1800;
 const exchanged=await pool.query(`UPDATE account_desktop_upload_grants AS g
  SET token_hash=$3,token_expires_at=LEAST(s.expires_at,now()+ $4::int * interval '1 second')
  FROM account_sessions s JOIN account_users u ON u.id=s.user_id
  WHERE g.code_hash=$1 AND g.challenge=$2 AND g.token_hash IS NULL AND g.code_expires_at>now()
  AND s.id=g.session_id AND s.expires_at>now() AND NOT u.web_beta
  RETURNING s.user_id, GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (g.token_expires_at-now()))))::int AS expires_in`,
  [hash(code),createHash('sha256').update(verifier).digest('base64url'),hash(token),expiresIn]);
 const grant=exchanged.rows[0];
 if(!grant){send(res,401,{error:'Invalid or expired authorization code'});return true;}
 send(res,200,{accessToken:token,expiresIn:grant.expires_in,accountId:grant.user_id});return true;
}

export async function desktopUploadUser(req:IncomingMessage,pool:QueryableV2):Promise<{id:number}|null>{
 const token=bearer(req);
 if(!token||req.headers.origin||req.headers.cookie)return null;
 const result=await pool.query(`SELECT s.user_id AS id FROM account_desktop_upload_grants g
  JOIN account_sessions s ON s.id=g.session_id
  JOIN account_users u ON u.id=s.user_id
  WHERE g.token_hash=$1 AND g.token_expires_at>now() AND s.expires_at>now() AND NOT u.web_beta`,[hash(token)]);
 const id=result.rows[0]?.id;
 return typeof id==='number'?{id}:null;
}
