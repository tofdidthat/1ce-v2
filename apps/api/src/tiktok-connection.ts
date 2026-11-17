// TikTok Login Kit (web) connection, deliberately separated from Content Posting.
// Connecting a TikTok account NEVER creates or publishes a video.
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {QueryableV2} from '../../../packages/shared/contracts.js';
import type {PublishingPool} from './publishing-jobs.js';
import {openPublishing,sealPublishing} from './publishing-secrets.js';
import {PublishingError} from './youtube-connection.js';

export type TikTokConfig={clientKey:string;clientSecret:string;redirectUri:string;webOrigin:string;encryptionSecret:string};
const stateCookie='onece_v2_tiktok_state';
const statePattern=/^ttpub_[A-Za-z0-9_-]{43}$/;
const browserPattern=/^[A-Za-z0-9_-]{43}$/;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const hasPublishScope=(scope:string)=>scope.split(',').map(x=>x.trim()).includes('video.publish');

export function tiktokConfig():TikTokConfig|null{
 const clientKey=process.env.TIKTOK_CLIENT_KEY,clientSecret=process.env.TIKTOK_CLIENT_SECRET;
 const redirectUri=process.env.TIKTOK_REDIRECT_URI,webOrigin=process.env.WEB_ORIGIN;
 // Reuse the publishing key hierarchy: changing it without migration breaks
 // already-encrypted YouTube and Instagram credentials.
 const encryptionSecret=process.env.PUBLISH_TOKEN_KEY||process.env.YOUTUBE_CLIENT_SECRET||process.env.GOOGLE_CLIENT_SECRET;
 if(!clientKey||!clientSecret||!redirectUri||!webOrigin||!encryptionSecret||encryptionSecret.length<16)return null;
 try{
  const callback=new URL(redirectUri),web=new URL(webOrigin);
  if(callback.protocol!=='https:'||callback.pathname!=='/auth/tiktok/callback'||callback.search||
   callback.hash||callback.username||callback.password||web.protocol!=='https:'||
   web.pathname!=='/'||web.search||web.hash||web.username||web.password)return null;
 }catch{return null;}
 return {clientKey,clientSecret,redirectUri,webOrigin,encryptionSecret};
}
export const tiktokCallbackPath=(config:TikTokConfig)=>new URL(config.redirectUri).pathname;

type TokenPair={access:string;refresh:string;openId:string;scope:string;accessSeconds:number;refreshSeconds:number};
function tokenPair(data:unknown):TokenPair{
 if(!record(data))throw new PublishingError('tiktok_token_exchange_failed',409);
 const validToken=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=8192;
 const validId=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=200&&
  !/[\x00-\x20\x7f]/.test(v);
 const accessSeconds=Number(data.expires_in),refreshSeconds=Number(data.refresh_expires_in);
 if(!validToken(data.access_token)||!validToken(data.refresh_token)||!validId(data.open_id)||
  typeof data.scope!=='string'||data.scope.length>500||
  !Number.isSafeInteger(accessSeconds)||accessSeconds<60||accessSeconds>86400||
  !Number.isSafeInteger(refreshSeconds)||refreshSeconds<3600||refreshSeconds>366*86400)
  throw new PublishingError('tiktok_token_exchange_failed',409);
 return {access:data.access_token,refresh:data.refresh_token,openId:data.open_id,
  scope:data.scope,accessSeconds,refreshSeconds};
}
async function mutating<T>(pool:PublishingPool,owner:number,task:(db:QueryableV2)=>Promise<T>):Promise<T>{
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock($1::bigint)',[owner]);
  const result=await task(db);await db.query('COMMIT');return result;
 }catch(error){try{await db.query('ROLLBACK')}catch{}throw error;}finally{db.release();}
}
export async function beginTikTokConnection(pool:PublishingPool,owner:number,config:TikTokConfig):Promise<{url:string}>{
 const state='ttpub_'+randomBytes(32).toString('base64url');
 await mutating(pool,owner,async db=>{
  await db.query('DELETE FROM v2_tiktok_oauth WHERE user_id=$1 OR expires_at<clock_timestamp()',[owner]);
  await db.query(`INSERT INTO v2_tiktok_oauth(state_hash,user_id,browser_hash,expires_at)
   VALUES($1,$2,'',clock_timestamp()+interval '10 minutes')`,[hash(state),owner]);
 });
 return {url:new URL('/auth/tiktok/start?state='+state,config.redirectUri).href};
}
export async function startTikTokConnection(pool:PublishingPool,owner:number,state:string,config:TikTokConfig):
 Promise<{url:string;cookie:string}>{
 if(!statePattern.test(state))throw new PublishingError('tiktok_state_expired',409);
 const browser=randomBytes(32).toString('base64url');
 const used=await mutating(pool,owner,db=>db.query(`UPDATE v2_tiktok_oauth SET browser_hash=$3
  WHERE state_hash=$1 AND user_id=$2 AND browser_hash='' AND expires_at>clock_timestamp()
  AND claim_token IS NULL RETURNING user_id`,[hash(state),owner,hash(browser)]));
 if(used.rowCount!==1)throw new PublishingError('tiktok_state_expired',409);
 const url=new URL('https://www.tiktok.com/v2/auth/authorize/');
 for(const [key,value] of Object.entries({client_key:config.clientKey,response_type:'code',
  scope:'user.info.basic,video.publish',redirect_uri:config.redirectUri,state}))
  url.searchParams.set(key,value);
 return {url:url.href,cookie:`${stateCookie}=${browser}; HttpOnly; Secure; SameSite=Lax; Path=/auth/tiktok/callback; Max-Age=600`};
}
export async function finishTikTokConnection(req:IncomingMessage,res:ServerResponse,url:URL,pool:PublishingPool,
 config:TikTokConfig,owner:number|null,http:typeof fetch=fetch):Promise<void>{
 const clear=`${stateCookie}=; HttpOnly; Secure; SameSite=Lax; Path=/auth/tiktok/callback; Max-Age=0`;
 let outcome='error',reason='tiktok_authorization_failed',step='session';
 try{
  const state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';
  const browser=(req.headers.cookie||'').split(';').map(v=>v.trim())
   .find(v=>v.startsWith(stateCookie+'='))?.slice(stateCookie.length+1)||'';
  if(!owner)throw new PublishingError('tiktok_session_missing',401);
  if(!statePattern.test(state)||!browserPattern.test(browser)||!code||code.length>4096||
   /\s/.test(code)||url.searchParams.has('error'))throw new PublishingError('tiktok_consent_denied',409);
  step='state';
  const claim=randomUUID();
  const used=await pool.query(`UPDATE v2_tiktok_oauth SET claim_token=$4::uuid
   WHERE state_hash=$1 AND browser_hash=$2 AND user_id=$3 AND claim_token IS NULL
    AND expires_at>clock_timestamp() RETURNING user_id`,[hash(state),hash(browser),owner,claim]);
  if(used.rowCount!==1||Number(used.rows[0]?.user_id)!==owner)
   throw new PublishingError('tiktok_state_expired',409);
  step='token';
  const response=await http('https://open.tiktokapis.com/v2/oauth/token/',{
   method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_key:config.clientKey,client_secret:config.clientSecret,
    code,grant_type:'authorization_code',redirect_uri:config.redirectUri}),
   signal:AbortSignal.timeout(15000)
  });
  const data:unknown=await response.json().catch(()=>null);
  if(!response.ok)throw new PublishingError('tiktok_token_exchange_failed',409);
  const token=tokenPair(data);
  if(!hasPublishScope(token.scope))
   throw new PublishingError('tiktok_scope_not_approved',409);
  step='storage';
  await mutating(pool,owner,async db=>{
   // Disconnect deletes the state; a callback that loses its claim cannot
   // resurrect a connection after a later unlink.
   const redeemed=await db.query(`DELETE FROM v2_tiktok_oauth
    WHERE state_hash=$1 AND browser_hash=$2 AND user_id=$3 AND claim_token=$4::uuid
     AND expires_at>clock_timestamp() RETURNING user_id`,[hash(state),hash(browser),owner,claim]);
   if(redeemed.rowCount!==1)throw new PublishingError('tiktok_state_expired',409);
   await db.query(`INSERT INTO v2_tiktok_connections
    (user_id,open_id,scope,access_cipher,refresh_cipher,access_expires_at,refresh_expires_at,generation)
    VALUES($1,$2,$3,$4,$5,clock_timestamp()+($6::int*interval '1 second'),
     clock_timestamp()+($7::int*interval '1 second'),$8::uuid)
    ON CONFLICT(user_id) DO UPDATE SET open_id=EXCLUDED.open_id,scope=EXCLUDED.scope,
     access_cipher=EXCLUDED.access_cipher,refresh_cipher=EXCLUDED.refresh_cipher,
     access_expires_at=EXCLUDED.access_expires_at,refresh_expires_at=EXCLUDED.refresh_expires_at,
     generation=EXCLUDED.generation,updated_at=clock_timestamp()`,[
    owner,token.openId,token.scope,
    sealPublishing(token.access,'tiktok-access:'+owner,config.encryptionSecret),
    sealPublishing(token.refresh,'tiktok-refresh:'+owner,config.encryptionSecret),
    token.accessSeconds,token.refreshSeconds,randomUUID()
   ]);
  });
  outcome='connected';
 }catch(error){
  // Never log provider body, code, callback URL, token or cookie.
  const allowed=new Set(['tiktok_session_missing','tiktok_consent_denied','tiktok_state_expired',
   'tiktok_token_exchange_failed','tiktok_scope_not_approved']);
  reason=error instanceof PublishingError&&allowed.has(error.code)?error.code:
   step==='token'?'tiktok_token_exchange_failed':step==='state'?'tiktok_state_expired':'tiktok_authorization_failed';
  console.warn('TikTok account connection failed',{step,reason});
 }
 res.writeHead(302,{'Location':config.webOrigin+'/app/upload?publishing=tiktok-'+outcome+
  (outcome==='error'?'&reason='+encodeURIComponent(reason):''),
  'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':clear});res.end();
}
export async function tikTokConnectionStatus(db:QueryableV2,owner:number,config:TikTokConfig|null):
 Promise<{available:boolean;connected:boolean;publishingEnabled:false}>{
 const empty={available:!!config,connected:false,publishingEnabled:false as const};
 if(!config)return empty;
 const row=(await db.query(`SELECT refresh_cipher,refresh_expires_at,scope FROM v2_tiktok_connections
  WHERE user_id=$1`,[owner])).rows[0];
 if(!row||new Date(row.refresh_expires_at).getTime()<=Date.now()||
  !hasPublishScope(String(row.scope)))return empty;
 try{openPublishing(String(row.refresh_cipher),'tiktok-refresh:'+owner,config.encryptionSecret);}
 catch{return empty;}
 return {available:true,connected:true,publishingEnabled:false};
}
export async function disconnectTikTok(pool:PublishingPool,owner:number,config:TikTokConfig,
 http:typeof fetch=fetch):Promise<{providerRevoked:boolean}>{
 const cipher=await mutating(pool,owner,async db=>{
  const old=(await db.query('SELECT access_cipher FROM v2_tiktok_connections WHERE user_id=$1',[owner])).rows[0];
  await db.query('DELETE FROM v2_tiktok_oauth WHERE user_id=$1',[owner]);
  await db.query('DELETE FROM v2_tiktok_connections WHERE user_id=$1',[owner]);
  return typeof old?.access_cipher==='string'?old.access_cipher:null;
 });
 if(!cipher)return {providerRevoked:true};
 let revoked=false;
 try{
  const token=openPublishing(cipher,'tiktok-access:'+owner,config.encryptionSecret);
  const response=await http('https://open.tiktokapis.com/v2/oauth/revoke/',{
   method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_key:config.clientKey,client_secret:config.clientSecret,token}),
   signal:AbortSignal.timeout(12000)
  });
  revoked=response.ok;
 }catch{/* Local credentials are removed, but remote revocation needs user review. */}
 return {providerRevoked:revoked};
}
