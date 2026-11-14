export type PublishingTarget={id:string;platform:string;variant:string;state:string;remoteId?:string|null;errorCode?:string|null};
export type PublishingStatus={available:boolean;connected:boolean;channelTitle?:string;jobs:{id:string;title:string;state:string;targets:PublishingTarget[]}[]};
export function publishingErrorMessage(code:unknown):string{
 const messages:Record<string,string>={
  youtube_not_connected:'Connect YouTube before publishing.',
  youtube_token_expired:'YouTube permission expired. Reconnect and grant access again.',
  youtube_reauth_required:'Reconnect YouTube and grant access again.',
  invalid_grant:'YouTube permission expired. Reconnect and grant access again.',
  needs_review:'The outcome is uncertain. Review the YouTube channel before any new submission.',
  publishing_unavailable:'Publishing is unavailable on this server. Please try again later.',
  audio_too_long:'Audio must be 20 minutes or less.',
  cover_too_large:'Use an image up to 15 MiB, 32 megapixels and 8192 pixels per side.',
  unauthorized:'Sign in again to continue.',
  forbidden:'This account does not have permission for this action.'
 };
 return typeof code==='string'&&Object.hasOwn(messages,code)?messages[code]:'Publishing could not complete. Check your connection and YouTube permissions, then review the job status.';
}
export type PublishingPayload={requestId:string;title:string;description:string;hashtags:string;targets:{platform:'youtube';variant:'shorts'|'standard'}[];audioFileId:number;coverFileId:number;privacy:'private'|'unlisted'|'public'};
export const canRetryPublishingTarget=(target:PublishingTarget)=>['failed','retryable'].includes(target.state)&&!target.remoteId;
export async function publishingRequest<T>(api:string,path:string,signal:AbortSignal,body?:unknown):Promise<T>{
 if(!api)throw Error('Publishing API is not configured');
 const response=await fetch(api+'/api/publishing'+path,{method:body===undefined?'GET':'POST',credentials:'include',cache:'no-store',signal,
  ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 const result=await response.json();
 if(!response.ok)throw Error(publishingErrorMessage(result?.error));
 if(path==='/status'&&(typeof result.available!=='boolean'||typeof result.connected!=='boolean'||!Array.isArray(result.jobs)||!result.jobs.every((job:Record<string,unknown>)=>job&&typeof job.id==='string'&&typeof job.title==='string'&&typeof job.state==='string'&&Array.isArray(job.targets)&&job.targets.every((target:Record<string,unknown>)=>target&&typeof target.id==='string'&&typeof target.state==='string'&&typeof target.platform==='string'&&typeof target.variant==='string'))))throw Error('Invalid publishing status');
 if(path==='/jobs'&&(typeof result.id!=='string'||typeof result.state!=='string'))throw Error('Invalid queue response; retry without editing');
 return result as T;
}
