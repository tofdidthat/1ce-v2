// Instagram Business Login Graph contract. No external calls happen unless
// the Instagram worker explicitly invokes this module for a consented job.
export type InstagramGraphId=string;
const graph='https://graph.instagram.com/v27.0';
const digits=/^[0-9]{1,32}$/;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export class InstagramReelError extends Error {
 constructor(public readonly code:string,public readonly retryable=false){super(code);}
}
function exactId(body:string):string{
 // Never round decimal Meta IDs through JSON.parse/Number. The ID must be a
 // top-level response member, not a nested provider error or debug field.
 const found=/^\s*\{\s*"id"\s*:\s*(?:"([0-9]{1,32})"|([0-9]{1,32}))\s*(?:,|\})/.exec(body);
 if(!found)throw new InstagramReelError('instagram_invalid_provider_id');
 return found[1]||found[2];
}
async function request(url:string,token:string,method:'GET'|'POST',payload:Record<string,string>|null,
 http:typeof fetch,timeoutMs=20000):Promise<string>{
 if(!token||token.length>8192)throw new InstagramReelError('instagram_reconnect_required');
 const response=await http(url,{method,redirect:'error',headers:{
  Authorization:'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})
 },...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(timeoutMs)});
 const body=await response.text();
 if(body.length>65536)throw new InstagramReelError('instagram_provider_response_invalid');
 if(!response.ok)throw new InstagramReelError('instagram_provider_rejected',response.status===429||response.status>=500);
 return body;
}
export function trustedInstagramDeliveryUrl(value:string,apiOrigin:string):string{
 let url:URL,origin:URL;
 try{url=new URL(value);origin=new URL(apiOrigin);}
 catch{throw new InstagramReelError('instagram_media_url_invalid');}
 if(origin.protocol!=='https:'||url.protocol!=='https:'||url.origin!==origin.origin||
  url.pathname!=='/api/publishing/meta-media'||url.hash||url.username||url.password||
  [...url.searchParams.keys()].length!==1||
  !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('token')||''))
  throw new InstagramReelError('instagram_media_url_invalid');
 return url.href;
}
export async function createInstagramReel({accountId,token,videoUrl,caption,http=fetch}:{
 accountId:string;token:string;videoUrl:string;caption:string;http?:typeof fetch
}):Promise<string>{
 if(!digits.test(accountId)||caption.length>2200||!videoUrl.startsWith('https://'))
  throw new InstagramReelError('instagram_publication_invalid');
 const url=graph+'/'+accountId+'/media';
 const body=await request(url,token,'POST',{media_type:'REELS',video_url:videoUrl,caption},http);
 return exactId(body);
}
export type InstagramContainerStatus='IN_PROGRESS'|'FINISHED'|'ERROR'|'EXPIRED'|'UNKNOWN';
export async function instagramReelStatus({containerId,token,http=fetch}:{
 containerId:string;token:string;http?:typeof fetch
}):Promise<InstagramContainerStatus>{
 if(!digits.test(containerId))throw new InstagramReelError('instagram_container_invalid');
 const url=graph+'/'+containerId+'?fields=status_code,status';
 const raw=await request(url,token,'GET',null,http);
 let data:unknown;
 try{data=JSON.parse(raw);}catch{throw new InstagramReelError('instagram_provider_response_invalid');}
 if(!record(data))throw new InstagramReelError('instagram_provider_response_invalid');
 return ['IN_PROGRESS','FINISHED','ERROR','EXPIRED'].includes(String(data.status_code))
  ?data.status_code as InstagramContainerStatus:'UNKNOWN';
}
export async function publishInstagramReel({accountId,containerId,token,http=fetch}:{
 accountId:string;containerId:string;token:string;http?:typeof fetch
}):Promise<string>{
 if(!digits.test(accountId)||!digits.test(containerId))throw new InstagramReelError('instagram_publication_invalid');
 const body=await request(graph+'/'+accountId+'/media_publish',token,'POST',{creation_id:containerId},http);
 return exactId(body);
}

export async function resolveInstagramPublishingAccount({token,oauthUserId,http=fetch}:{
 token:string;oauthUserId:string;http?:typeof fetch
}):Promise<string>{
 if(!digits.test(oauthUserId))throw new InstagramReelError('instagram_identity_mismatch');
 const raw=await request('https://graph.instagram.com/me?fields=id,user_id,username',token,'GET',null,http);
 // Preserve all digits. OAuth user_id and /me id may differ, but the /me
 // user_id returned by Instagram Login identifies the publishing account.
 const exact=(field:string)=>new RegExp('"' + field + '"\\s*:\\s*(?:"([0-9]{1,32})"|([0-9]{1,32}))(?=\\s*[,}])').exec(raw);
 const id=exact('id'),userId=exact('user_id');
 const a=id?.[1]||id?.[2]||'',b=userId?.[1]||userId?.[2]||'';
 if(oauthUserId!==a&&oauthUserId!==b)
  throw new InstagramReelError('instagram_identity_mismatch');
 const chosen=b||a;
 if(!digits.test(chosen))throw new InstagramReelError('instagram_profile_unavailable');
 return chosen;
}
