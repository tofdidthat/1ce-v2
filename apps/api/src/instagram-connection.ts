import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {QueryableV2} from '../../../packages/shared/contracts.js';
import {openPublishing,sealPublishing} from './publishing-secrets.js';
import {PublishingError} from './youtube-connection.js';

export type InstagramConfig={appId:string;appSecret:string;redirectUri:string;webOrigin:string;encryptionSecret:string};
const cookieName='onece_v2_instagram_state';
const statePattern=/^igpub_[A-Za-z0-9_-]{43}$/;
const browserPattern=/^[A-Za-z0-9_-]{43}$/;
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
// Provider IDs can exceed Number.MAX_SAFE_INTEGER. Read their decimal text exactly.
function exactInstagramId(raw:string,parsed:unknown):string{
 const match=/"user_id"\s*:\s*(?:"([0-9]{1,32})"|([0-9]{1,32}))(?=\s*[,}])/.exec(raw);
 if(match)return match[1]||match[2];
 return record(parsed)&&typeof parsed.id==='string'&&/^[0-9]{1,32}$/.test(parsed.id)?parsed.id:'';
}

export function instagramConfig():InstagramConfig|null{
 const {INSTAGRAM_APP_ID:appId,INSTAGRAM_APP_SECRET:appSecret,INSTAGRAM_REDIRECT_URI:redirectUri,WEB_ORIGIN:webOrigin}=process.env;
 // Use the existing stable 1CE publishing encryption key, never the Instagram token as a key.
 const encryptionSecret=process.env.PUBLISH_TOKEN_KEY||process.env.GOOGLE_CLIENT_SECRET;
 if(!appId||!appSecret||!redirectUri||!webOrigin||!encryptionSecret||encryptionSecret.length<16)return null;
 try{
  const callback=new URL(redirectUri),web=new URL(webOrigin);
  if(callback.protocol!=='https:'||web.protocol!=='https:'||callback.pathname!=='/auth/instagram/callback'||
   callback.search||callback.hash||callback.username||callback.password||web.pathname!=='/'||
   web.search||web.hash||web.username||web.password)return null;
 }catch{return null;}
 return {appId,appSecret,redirectUri,webOrigin,encryptionSecret};
}
export function instagramCallbackPath(config:InstagramConfig):string{
 return new URL(config.redirectUri).pathname;
}
export async function beginInstagramConnection(db:QueryableV2,owner:number,config:InstagramConfig):Promise<{url:string}>{
 const state='igpub_'+randomBytes(32).toString('base64url');
 await db.query('DELETE FROM v2_instagram_oauth WHERE expires_at<clock_timestamp() OR user_id=$1',[owner]);
 await db.query(`INSERT INTO v2_instagram_oauth(state_hash,user_id,browser_hash,expires_at)
  VALUES($1,$2,'',clock_timestamp()+interval '10 minutes')`,[sha(state),owner]);
 return {url:new URL('/auth/instagram/start?state='+state,config.redirectUri).href};
}
export async function startInstagramConnection(db:QueryableV2,owner:number,state:string,config:InstagramConfig):Promise<{url:string;cookie:string}>{
 if(!statePattern.test(state))throw new PublishingError('instagram_state_expired',409);
 const browser=randomBytes(32).toString('base64url');
 const result=await db.query(`UPDATE v2_instagram_oauth SET browser_hash=$3 WHERE state_hash=$1 AND user_id=$2
  AND browser_hash='' AND expires_at>clock_timestamp() RETURNING user_id`,[sha(state),owner,sha(browser)]);
 if(result.rowCount!==1)throw new PublishingError('instagram_state_expired',409);
 const url=new URL('https://www.instagram.com/oauth/authorize');
 for(const [k,v] of Object.entries({client_id:config.appId,redirect_uri:config.redirectUri,response_type:'code',
  scope:'instagram_business_basic,instagram_business_content_publish',state}))url.searchParams.set(k,v);
 return {url:url.href,cookie:`${cookieName}=${browser}; HttpOnly; Secure; SameSite=Lax; Path=/auth/instagram/callback; Max-Age=600`};
}
export async function finishInstagramConnection(req:IncomingMessage,res:ServerResponse,url:URL,db:QueryableV2,config:InstagramConfig,owner:number|null,http:typeof fetch=fetch):Promise<void>{
 const clear=`${cookieName}=; HttpOnly; Secure; SameSite=Lax; Path=/auth/instagram/callback; Max-Age=0`;
 let outcome='error';
 try{
  const state=url.searchParams.get('state')||'';
  const code=(url.searchParams.get('code')||'').replace(/#_$/,'');
  const browser=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
  if(!owner||!statePattern.test(state)||!browserPattern.test(browser)||!code||code.length>4096||
   /[\s\r\n]/.test(code)||url.searchParams.has('error'))throw new PublishingError('instagram_consent_denied');
  const used=await db.query(`DELETE FROM v2_instagram_oauth WHERE state_hash=$1 AND browser_hash=$2
   AND user_id=$3 AND expires_at>clock_timestamp() RETURNING user_id`,[sha(state),sha(browser),owner]);
  if(used.rowCount!==1||Number(used.rows[0]?.user_id)!==owner)throw new PublishingError('instagram_state_expired',409);
  const short=await http('https://api.instagram.com/oauth/access_token',{method:'POST',redirect:'error',
   headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({
    client_id:config.appId,client_secret:config.appSecret,grant_type:'authorization_code',
    redirect_uri:config.redirectUri,code}),signal:AbortSignal.timeout(15000)});
  const shortText=await short.text();
  const shortData:unknown=(()=>{try{return JSON.parse(shortText)}catch{return null}})();
  if(!short.ok||!record(shortData)||typeof shortData.access_token!=='string'||shortData.access_token.length>8192)
   throw new PublishingError('instagram_authorization_failed');
  const instagramId=exactInstagramId(shortText,shortData);
  if(!/^[0-9]{1,32}$/.test(instagramId))throw new PublishingError('instagram_authorization_failed');
  const longUrl=new URL('https://graph.instagram.com/access_token');
  longUrl.search=new URLSearchParams({grant_type:'ig_exchange_token',client_secret:config.appSecret,
   access_token:shortData.access_token}).toString();
  const long=await http(longUrl.href,{redirect:'error',signal:AbortSignal.timeout(15000)});
  const longData:unknown=await long.json().catch(()=>null);
  if(!long.ok||!record(longData)||typeof longData.access_token!=='string'||
   !longData.access_token||longData.access_token.length>8192||
   typeof longData.expires_in!=='number'||longData.expires_in<3600||longData.expires_in>7776000)
   throw new PublishingError('instagram_authorization_failed');
  const me=await http('https://graph.instagram.com/me?fields=user_id,username,account_type',{
   headers:{Authorization:'Bearer '+longData.access_token},redirect:'error',signal:AbortSignal.timeout(15000)});
  const profileText=await me.text();
  const profile:unknown=(()=>{try{return JSON.parse(profileText)}catch{return null}})();
  const meId=exactInstagramId(profileText,profile);
  if(!me.ok||!record(profile)||meId!==instagramId||typeof profile.username!=='string'||
   !/^[A-Za-z0-9._]{1,180}$/.test(profile.username)||!['BUSINESS','MEDIA_CREATOR','CREATOR'].includes(String(profile.account_type)))
   throw new PublishingError('instagram_professional_account_required',409);
  await db.query(`INSERT INTO v2_instagram_connections
    (user_id,instagram_user_id,username,access_cipher,expires_at,generation)
    VALUES($1,$2,$3,$4,clock_timestamp()+($5::int*interval '1 second'),$6::uuid)
    ON CONFLICT(user_id) DO UPDATE SET instagram_user_id=EXCLUDED.instagram_user_id,
    username=EXCLUDED.username,access_cipher=EXCLUDED.access_cipher,expires_at=EXCLUDED.expires_at,
    generation=EXCLUDED.generation,updated_at=clock_timestamp()`,
   [owner,instagramId,profile.username,sealPublishing(longData.access_token,'instagram-access:'+owner,config.encryptionSecret),
    Math.floor(longData.expires_in),randomUUID()]);
  outcome='connected';
 }catch{/* Never disclose provider error payload, authorization codes, cookies or access tokens. */}
 res.writeHead(302,{'Location':config.webOrigin+'/app/upload?publishing=instagram-'+outcome,
  'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':clear});res.end();
}
export async function instagramConnectionStatus(db:QueryableV2,owner:number,config:InstagramConfig|null):
 Promise<{available:boolean;connected:boolean;username:string|null;publishingEnabled:false}>{
 const empty={available:!!config,connected:false,username:null,publishingEnabled:false as const};
 if(!config)return empty;
 const row=(await db.query('SELECT username,access_cipher,expires_at FROM v2_instagram_connections WHERE user_id=$1',[owner])).rows[0];
 if(!row||new Date(String(row.expires_at)).getTime()<=Date.now())return empty;
 try{openPublishing(String(row.access_cipher),'instagram-access:'+owner,config.encryptionSecret);}
 catch{return empty;}
 return {available:true,connected:true,username:String(row.username),publishingEnabled:false};
}
export async function disconnectInstagram(db:QueryableV2,owner:number):Promise<void>{
 await db.query('DELETE FROM v2_instagram_oauth WHERE user_id=$1',[owner]);
 // This disconnects 1CE; users may additionally revoke the app from Instagram settings.
 await db.query('DELETE FROM v2_instagram_connections WHERE user_id=$1',[owner]);
}
