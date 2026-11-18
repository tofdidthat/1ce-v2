import {PublishingError} from './youtube-connection.js';

export const mediaPath = '/api/publishing/tiktok-media';
export const draftMaxDurationSec = 600;

function httpsOrigin(raw: string | undefined): string | null {
 try {
  const url = new URL(raw || '');
  return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null;
 } catch { return null; }
}

export function deliveryEndpoint(): string | null {
 if (process.env.TIKTOK_DRAFT_UPLOAD_ENABLED !== 'true') return null;
 const web = httpsOrigin(process.env.WEB_ORIGIN);
 const callback = httpsOrigin(process.env.TIKTOK_REDIRECT_URI);
 const configured = process.env.TIKTOK_VERIFIED_URL_PREFIX;
 if (!configured) return web === 'https://1ce.lol' ? web + mediaPath : null;
 try {
  const prefix = new URL(configured);
  if (prefix.protocol !== 'https:' || ![web,callback].includes(prefix.origin) ||
      prefix.username || prefix.password || prefix.search || prefix.hash ||
      !(mediaPath === prefix.pathname || mediaPath.startsWith(prefix.pathname.replace(/\/$/,'') + '/'))) return null;
  return new URL(mediaPath, prefix).href;
 } catch { return null; }
}

export function parseTikTokDraftConsent(value: unknown): {connectionId:string;consent:true} {
 const p = value as {connectionId?:unknown;consent?:unknown} | null;
 if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length !== 2 || p.consent !== true ||
     typeof p.connectionId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(p.connectionId))
  throw new PublishingError('tiktok_consent_required',400);
 return {connectionId:p.connectionId,consent:true};
}

// These documented init rejections prove the provider did not start a share.
// An unrecognized reply, timeout, or 5xx leaves the checkpoint intact.
const initRejections: Record<string,{http:number;code:string;status:number}> = {
 invalid_param:{http:400,code:'tiktok_draft_rejected',status:422},
 spam_risk_too_many_pending_share:{http:403,code:'tiktok_pending_drafts_limit',status:409},
 spam_risk_user_banned_from_posting:{http:403,code:'tiktok_draft_rejected',status:422},
 url_ownership_unverified:{http:403,code:'tiktok_url_unverified',status:422},
 access_token_invalid:{http:401,code:'tiktok_reconnect_required',status:409},
 scope_not_authorized:{http:401,code:'tiktok_reconnect_required',status:409},
 rate_limit_exceeded:{http:429,code:'tiktok_rate_limited',status:429}
};

export class TikTokDraftRejected extends PublishingError {}

export async function tikTokPost(path:'inbox/video/init'|'status/fetch',token:string,body:object,http:typeof fetch) {
 const response = await http('https://open.tiktokapis.com/v2/post/publish/'+path+'/', {
  method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{
   Authorization:'Bearer '+token,'Content-Type':'application/json; charset=UTF-8'},body:JSON.stringify(body)
 });
 const result = await response.json().catch(()=>null);
 const code = result?.error?.code;
 if (path === 'inbox/video/init' && typeof code === 'string' && Object.hasOwn(initRejections,code)) {
  const rejection = initRejections[code];
  if (response.status === rejection.http && !result?.data?.publish_id)
   throw new TikTokDraftRejected(rejection.code,rejection.status);
 }
 if (response.status===429) throw new PublishingError('tiktok_rate_limited',429);
 if ([401,403].includes(response.status)) throw new PublishingError('tiktok_reconnect_required',409);
 if (!response.ok || code!=='ok' || !result.data || typeof result.data!=='object' || Array.isArray(result.data))
  throw new PublishingError('tiktok_provider_unavailable',response.status>=500?503:422);
 return result.data as Record<string,unknown>;
}
