export type PublishingTarget={id:string;platform:string;variant:string;state:string;remoteId?:string|null;errorCode?:string|null};
export type PublishingStatus={available:boolean;connected:boolean;channelTitle?:string;jobs:{id:string;title:string;state:string;targets:PublishingTarget[]}[]};
export function publishingErrorMessage(code:unknown):string{
 const messages:Record<string,string>={
  youtube_reconnect_required:'Reconnect YouTube and grant both channel and upload permissions.',
  youtube_not_configured:'YouTube publishing is not configured on this server.',
  youtube_temporarily_unavailable:'YouTube is temporarily unavailable. The same upload session will be checked again.',
  youtube_confirmation_pending:'Upload confirmation is pending. Check the job before submitting again.',
  youtube_visibility_restricted:'YouTube did not confirm the requested visibility. Review the uploaded video; do not submit it again.',
  youtube_upload_needs_review:'Review this upload on YouTube before making another submission.',
  youtube_disconnect_retry:'YouTube could not confirm disconnection. Please try disconnecting again.',
  renderer_unavailable:'The server video renderer is unavailable. Please try again later.',
  publishing_storage_unavailable:'Publishing storage is unavailable. Please try again later.',
  audio_must_be_under_20_minutes:'Standard video audio must be 20 minutes or less.',
  shorts_must_be_under_3_minutes:'Shorts require audio of 3 minutes or less. Use a shorter track or select Standard video.',
  cover_dimensions_too_large:'Use an image up to 32 megapixels and 8192 pixels per side.',
  render_limit_exceeded:'The rendered video exceeds the processing or 256 MiB limit. Try a shorter track.',
  video_render_failed:'The server could not render this image and audio. Try another valid PNG/JPEG/WEBP and MP3/WAV.',
  publication_queue_full:'Your queue already has 10 active jobs. Wait for a job to finish.',
  publication_hourly_limit:'You can submit up to 30 new publishing jobs per hour. Retry an existing failed destination instead.',
  request_id_conflict:'This submission changed after acceptance. Review publishing history before creating a new one.',
  owned_ready_media_required:'The audio and image must be verified files owned by this account.',
  source_media_missing:'The original audio or image is no longer available.',
  publication_connection_changed:'The connected channel changed. Review the previous upload before submitting again.',
  target_not_retryable:'This destination cannot be retried automatically. Review its current status.',
  not_authenticated:'Sign in again to continue.',
  origin_not_allowed:'Open publishing from the configured 1CE address.',
  invalid_publication_request:'Check the title, description, image, audio and selected YouTube format.',
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
export function publishingAuthorizationUrl(api:string,value:unknown):string{
 if(typeof value!=='string')throw Error('Invalid authorization URL');
 const url=new URL(value),backend=new URL(api);
 if(url.protocol!=='https:'||url.origin!==backend.origin||url.pathname!=='/auth/youtube/start'||url.username||url.password||url.hash||
  !/^pub_[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('state')||''))throw Error('Invalid authorization URL');
 return url.href;
}
export async function publishingRequest<T>(api:string,path:string,signal:AbortSignal,body?:unknown):Promise<T>{
 if(!api)throw Error('Publishing API is not configured');
 const response=await fetch(api+'/api/publishing'+path,{method:body===undefined?'GET':'POST',credentials:'include',cache:'no-store',signal,
  ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 const parsed:unknown=await response.json().catch(()=>null);
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Invalid publishing response');
 const result=parsed as Record<string,unknown>;
 if(!response.ok)throw Error(publishingErrorMessage(result?.error));
 if(path==='/status'&&(typeof result.available!=='boolean'||typeof result.connected!=='boolean'||!Array.isArray(result.jobs)||!result.jobs.every((job:Record<string,unknown>)=>job&&typeof job.id==='string'&&typeof job.title==='string'&&typeof job.state==='string'&&Array.isArray(job.targets)&&job.targets.every((target:Record<string,unknown>)=>target&&typeof target.id==='string'&&typeof target.state==='string'&&typeof target.platform==='string'&&typeof target.variant==='string'))))throw Error('Invalid publishing status');
 if(path==='/jobs'&&(typeof result.id!=='string'||typeof result.state!=='string'))throw Error('Invalid queue response; retry without editing');
 return result as T;
}
