import {PublishingError} from './youtube-connection.js';

const privacyLevels = ['SELF_ONLY','MUTUAL_FOLLOW_FRIENDS','PUBLIC_TO_EVERYONE','FOLLOWER_OF_CREATOR'];
export const mediaPath = '/api/publishing/tiktok-media';
export function deliveryEndpoint(): string | null {
 if (process.env.TIKTOK_DIRECT_POST_ENABLED !== 'true') return null;
 try {
  const callback = new URL(process.env.TIKTOK_REDIRECT_URI || '');
  const prefix = new URL(process.env.TIKTOK_VERIFIED_URL_PREFIX || '');
  const endpoint = new URL(mediaPath, callback);
  if (prefix.protocol !== 'https:' || prefix.origin !== endpoint.origin || prefix.username || prefix.password ||
      prefix.search || prefix.hash || !(endpoint.pathname === prefix.pathname ||
      endpoint.pathname.startsWith(prefix.pathname.replace(/\/$/,'') + '/'))) return null;
  return endpoint.href;
 } catch { return null; }
}
export type Preferences = {connectionId:string;title:string;privacyLevel:string;allowComment:boolean;
 allowDuet:boolean;allowStitch:boolean;ownBrand:boolean;brandedContent:boolean;consent:true};
export function parseTikTokPreferences(value:unknown):Preferences {
 const p = value as Partial<Preferences> | null;
 if (!p || p.consent !== true || typeof p.title !== 'string' || p.title.length > 2200 ||
     typeof p.connectionId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p.connectionId) ||
     [p.allowComment,p.allowDuet,p.allowStitch,p.ownBrand,p.brandedContent].some(v=>typeof v !== 'boolean'))
  throw new PublishingError('tiktok_consent_required',400);
 if (!privacyLevels.includes(String(p.privacyLevel)) || (p.brandedContent && !['PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS'].includes(String(p.privacyLevel))) ||
     (process.env.TIKTOK_AUDITED !== 'true' && p.privacyLevel !== 'SELF_ONLY'))
  throw new PublishingError('tiktok_privacy_invalid',400);
 return {connectionId:p.connectionId,title:p.title,privacyLevel:p.privacyLevel!,allowComment:p.allowComment!,
  allowDuet:p.allowDuet!,allowStitch:p.allowStitch!,ownBrand:p.ownBrand!,brandedContent:p.brandedContent!,consent:true};
}
export async function tikTokPost(path:'creator_info/query'|'video/init'|'status/fetch',token:string,body:object,http:typeof fetch) {
 const response = await http('https://open.tiktokapis.com/v2/post/publish/'+path+'/', {
  method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{
   Authorization:'Bearer '+token,'Content-Type':'application/json; charset=UTF-8'},body:JSON.stringify(body)
 });
 const result = await response.json().catch(()=>null);
 if (response.status===429 || result?.error?.code==='rate_limit_exceeded') throw new PublishingError('tiktok_rate_limited',429);
 if ([401,403].includes(response.status)) throw new PublishingError('tiktok_reconnect_required',409);
 if (!response.ok || result?.error?.code!=='ok' || !result.data || typeof result.data!=='object')
  throw new PublishingError('tiktok_provider_unavailable',response.status>=500?503:422);
 return result.data as Record<string,unknown>;
}
export async function creatorInfo(token:string,connectionId:string,http:typeof fetch) {
 const data=await tikTokPost('creator_info/query',token,{},http);
 if(typeof data.creator_nickname!=='string'||!data.creator_nickname||typeof data.creator_username!=='string'||
    !Array.isArray(data.privacy_level_options)||!Number.isSafeInteger(data.max_video_post_duration_sec)||
    Number(data.max_video_post_duration_sec)<1||
    [data.comment_disabled,data.duet_disabled,data.stitch_disabled].some(v=>typeof v!=='boolean'))
  throw new PublishingError('tiktok_creator_unavailable',409);
 const options=privacyLevels.filter(level=>(data.privacy_level_options as unknown[]).includes(level));
 const audited=process.env.TIKTOK_AUDITED==='true';
 return {connectionId,nickname:data.creator_nickname,username:data.creator_username,
  privacyLevelOptions:audited?options:options.filter(level=>level==='SELF_ONLY'&&!options.includes('PUBLIC_TO_EVERYONE')),
  commentDisabled:data.comment_disabled,duetDisabled:data.duet_disabled,stitchDisabled:data.stitch_disabled,
  maxVideoPostDurationSec:Math.min(1200,Number(data.max_video_post_duration_sec))};
}
export function validateCreator(p:Preferences,c:Awaited<ReturnType<typeof creatorInfo>>) {
 if(p.connectionId!==c.connectionId)throw new PublishingError('tiktok_creator_changed',409);
 if(!c.privacyLevelOptions.includes(p.privacyLevel)||(p.allowComment&&c.commentDisabled)||
    (p.allowDuet&&c.duetDisabled)||(p.allowStitch&&c.stitchDisabled))throw new PublishingError('tiktok_privacy_invalid',409);
}
