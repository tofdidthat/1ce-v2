import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {QueryableV2} from '../../../packages/shared/contracts.js';
import {openPublishing,sealPublishing,type PublishingConfig} from './publishing-secrets.js';
const uploadScope='https://www.googleapis.com/auth/youtube.upload';
const readScope='https://www.googleapis.com/auth/youtube.readonly';
const cookieName='onece_v2_youtube_state';
export class PublishingError extends Error {
 constructor(public code:string,public status=400){super(code);this.name='PublishingError';}
}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function credential(value:unknown):string{
 if(typeof value!=='string'||value.length<1||value.length>8192||/[\s\r\n]/.test(value))throw new PublishingError('youtube_connection_invalid',503);
 return value;
}
export async function beginYouTubeConnection(db:QueryableV2,owner:number,config:PublishingConfig):Promise<{url:string}>{
 const state='pub_'+randomBytes(32).toString('base64url');
 const verifier=randomBytes(48).toString('base64url');
 await db.query('DELETE FROM v2_youtube_oauth WHERE expires_at<clock_timestamp() OR user_id=$1',[owner]);
 await db.query(`INSERT INTO v2_youtube_oauth(state_hash,user_id,browser_hash,verifier_cipher,expires_at)
  VALUES($1,$2,$3,$4,clock_timestamp()+interval '10 minutes')`,
 [hash(state),owner,'',sealPublishing(verifier,'youtube-state:'+owner,config.encryptionSecret)]);
 return {url:new URL('/auth/youtube/start?state='+state,config.redirectUri).href};
}
export async function startYouTubeConnection(db:QueryableV2,owner:number,state:string,config:PublishingConfig):Promise<{url:string;cookie:string}>{
 if(!/^pub_[A-Za-z0-9_-]{43}$/.test(state))throw new PublishingError('youtube_state_expired');
 const browser=randomBytes(32).toString('base64url');
 const started=await db.query(`UPDATE v2_youtube_oauth SET browser_hash=$3 WHERE state_hash=$1 AND user_id=$2
  AND browser_hash='' AND expires_at>clock_timestamp() RETURNING verifier_cipher`,[hash(state),owner,hash(browser)]);
 if(started.rowCount!==1)throw new PublishingError('youtube_state_expired');
 const verifier=openPublishing(String(started.rows[0].verifier_cipher),'youtube-state:'+owner,config.encryptionSecret);
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 for(const [k,v] of Object.entries({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',
  scope:uploadScope+' '+readScope,access_type:'offline',prompt:'consent',state,
  code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))url.searchParams.set(k,v);
 return {url:url.href,cookie:`${cookieName}=${browser}; HttpOnly; Secure; SameSite=Lax; Path=${new URL(config.redirectUri).pathname}; Max-Age=600`};
}
export async function finishYouTubeConnection(req:IncomingMessage,res:ServerResponse,url:URL,db:QueryableV2,config:PublishingConfig,expectedOwner:number|null,http:typeof fetch=fetch):Promise<void>{
 const clear=`${cookieName}=; HttpOnly; Secure; SameSite=Lax; Path=${new URL(config.redirectUri).pathname}; Max-Age=0`;
 let outcome='error';
 try{
  const state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';
  const browser=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
  if(!expectedOwner||!/^pub_[A-Za-z0-9_-]{43}$/.test(state)||!/^[A-Za-z0-9_-]{43}$/.test(browser)||!code||code.length>4096||url.searchParams.has('error'))throw new PublishingError('youtube_consent_denied');
  const used=await db.query(`DELETE FROM v2_youtube_oauth WHERE state_hash=$1 AND browser_hash=$2
   AND user_id=$3 AND expires_at>clock_timestamp() RETURNING user_id,verifier_cipher`,[hash(state),hash(browser),expectedOwner]);
  const row=used.rows[0];if(!row)throw new PublishingError('youtube_state_expired');
  if(Number(row.user_id)!==expectedOwner)throw new PublishingError('youtube_state_expired');
  const owner=Number(row.user_id);
  const verifier=openPublishing(String(row.verifier_cipher),'youtube-state:'+owner,config.encryptionSecret);
  const response=await http('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',
   headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,
    client_secret:config.clientSecret,redirect_uri:config.redirectUri,code,code_verifier:verifier,grant_type:'authorization_code'}),signal:AbortSignal.timeout(15000)});
  const tokens:unknown=await response.json().catch(()=>null);
  if(!response.ok||!record(tokens))throw new PublishingError('youtube_authorization_failed');
  const scopes=typeof tokens.scope==='string'?tokens.scope.split(/\s+/):[];
  if(!scopes.includes(uploadScope)||!scopes.includes(readScope))throw new PublishingError('youtube_scopes_missing');
  const access=credential(tokens.access_token),refresh=credential(tokens.refresh_token);
  const channelResponse=await http('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',{
   headers:{Authorization:'Bearer '+access},redirect:'error',signal:AbortSignal.timeout(15000)});
  const channels:unknown=await channelResponse.json().catch(()=>null);
  const first=record(channels)&&Array.isArray(channels.items)?channels.items[0]:null;
  if(!channelResponse.ok||!record(first)||typeof first.id!=='string'||!/^UC[A-Za-z0-9_-]{20,30}$/.test(first.id)||!record(first.snippet)||typeof first.snippet.title!=='string')throw new PublishingError('youtube_channel_required');
  await db.query(`INSERT INTO v2_youtube_connections(user_id,refresh_cipher,channel_id,channel_title,generation)
   VALUES($1,$2,$3,$4,$5::uuid) ON CONFLICT(user_id) DO UPDATE SET refresh_cipher=EXCLUDED.refresh_cipher,
    channel_id=EXCLUDED.channel_id,channel_title=EXCLUDED.channel_title,generation=EXCLUDED.generation,updated_at=clock_timestamp()`,
  [owner,sealPublishing(refresh,'youtube-refresh:'+owner,config.encryptionSecret),first.id,first.snippet.title.slice(0,180),randomUUID()]);
  outcome='connected';
 }catch{/* No provider payload, token, code or session URI is exposed in logs/redirects. */}
 res.writeHead(302,{'Location':config.webOrigin+'/app/upload?publishing=youtube-'+outcome,
  'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':clear});res.end();
}
export async function youtubeAccess(db:QueryableV2,owner:number,config:PublishingConfig,http:typeof fetch=fetch):Promise<{accessToken:string;generation:string;expiresAt:number}>{
 const row=(await db.query('SELECT refresh_cipher,generation FROM v2_youtube_connections WHERE user_id=$1',[owner])).rows[0];
 if(!row)throw new PublishingError('youtube_reconnect_required',409);
 let refresh:string;
 try{refresh=openPublishing(String(row.refresh_cipher),'youtube-refresh:'+owner,config.encryptionSecret);}catch{throw new PublishingError('youtube_reconnect_required',409);}
 const response=await http('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',
  headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,
   refresh_token:refresh,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});
 const token:unknown=await response.json().catch(()=>null);
 if(!response.ok||!record(token)){
  if(response.status===400||response.status===401)await db.query('DELETE FROM v2_youtube_connections WHERE user_id=$1 AND generation=$2::uuid AND refresh_cipher=$3',[owner,row.generation,row.refresh_cipher]);
  throw new PublishingError(response.status>=500?'youtube_temporarily_unavailable':'youtube_reconnect_required',response.status>=500?503:409);
 }
 if(typeof token.scope==='string'&&(!token.scope.split(/\s+/).includes(uploadScope)||!token.scope.split(/\s+/).includes(readScope))){
  await db.query('DELETE FROM v2_youtube_connections WHERE user_id=$1 AND generation=$2::uuid AND refresh_cipher=$3',[owner,row.generation,row.refresh_cipher]);
  throw new PublishingError('youtube_reconnect_required',409);
 }
 if(typeof token.refresh_token==='string')await db.query(`UPDATE v2_youtube_connections SET refresh_cipher=$3,updated_at=clock_timestamp()
  WHERE user_id=$1 AND generation=$2::uuid AND refresh_cipher=$4`,[owner,row.generation,
  sealPublishing(credential(token.refresh_token),'youtube-refresh:'+owner,config.encryptionSecret),row.refresh_cipher]);
 const seconds=typeof token.expires_in==='number'&&token.expires_in>=60&&token.expires_in<=86400?token.expires_in:300;
 return {accessToken:credential(token.access_token),generation:String(row.generation),expiresAt:Date.now()+seconds*1000};
}
export async function disconnectYouTube(db:QueryableV2,owner:number,config:PublishingConfig,http:typeof fetch=fetch):Promise<void>{
 await db.query('DELETE FROM v2_youtube_oauth WHERE user_id=$1',[owner]);
 const row=(await db.query('SELECT refresh_cipher FROM v2_youtube_connections WHERE user_id=$1',[owner])).rows[0];
 if(!row)return;
 const token=openPublishing(String(row.refresh_cipher),'youtube-refresh:'+owner,config.encryptionSecret);
 const response=await http('https://oauth2.googleapis.com/revoke',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({token}),signal:AbortSignal.timeout(15000)});
 if(!response.ok&&response.status!==400)throw new PublishingError('youtube_disconnect_retry',503);
 await db.query('DELETE FROM v2_youtube_connections WHERE user_id=$1 AND refresh_cipher=$2',[owner,row.refresh_cipher]);
}
