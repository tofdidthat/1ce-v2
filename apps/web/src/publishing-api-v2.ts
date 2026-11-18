import type {TikTokDraftUpload} from './tiktok-draft-v2.ts';

export type PublishingTarget={id:string;platform:string;variant:string;state:string;remoteId?:string|null;errorCode?:string|null};
export type InstagramPublishingStatus={available:boolean;connected:boolean;username:string|null;publishingEnabled:boolean};
export type TikTokPublishingStatus={available:boolean;connected:boolean;publishingEnabled:boolean;nickname?:string|null;connectionId?:string|null};
export type PublishingStatus={available:boolean;connected:boolean;channelTitle?:string;instagram?:InstagramPublishingStatus;tiktok?:TikTokPublishingStatus;jobs:{id:string;requestId:string;title:string;state:string;targets:PublishingTarget[]}[]};
export function publishingErrorMessage(code:unknown):string{
 const messages:Record<string,string>={
  tiktok_draft_upload_disabled:'TikTok draft uploads are currently unavailable.',
  tiktok_consent_required:'Confirm that you want to send a TikTok draft.',
  tiktok_connection_changed:'The TikTok account changed. Verify the connected account before sending the draft.',
  tiktok_reconnect_required:'Reconnect TikTok and grant permission to upload videos.',
  tiktok_rate_limited:'TikTok reached an upload limit. Try again later.',
  tiktok_init_uncertain:'TikTok did not confirm that it received the video.',
  tiktok_status_unknown:'TikTok did not confirm delivery to your inbox.',
  tiktok_duration_invalid:'The rendered video is outside TikTok?s allowed duration.',
  tiktok_draft_failed:'TikTok could not deliver the draft.',
  tiktok_draft_rejected:'TikTok rejected the draft. Check the video and account permissions.',
  tiktok_pending_drafts_limit:'TikTok has too many pending drafts. Open your TikTok inbox to review them.',
  tiktok_identity_mismatch:'TikTok returned a different account. Reconnect and verify the account.',
  tiktok_refresh_failed:'Reconnect TikTok to renew upload permission.',
  tiktok_url_unverified:'TikTok draft delivery is currently unavailable.',
  tiktok_provider_unavailable:'TikTok is temporarily unavailable.',
  tiktok_temporarily_unavailable:'TikTok is temporarily unavailable.',
  tiktok_not_configured:'TikTok Login Kit is not configured. Add the TikTok developer app credentials before connecting.',
  tiktok_session_missing:'Sign in to 1CE again before connecting your TikTok account.',
  tiktok_consent_denied:'TikTok consent was cancelled or denied. Try connecting again.',
  tiktok_state_expired:'The TikTok authorization expired. Start the connection again.',
  tiktok_token_exchange_failed:'TikTok did not accept the authorization. Check client key, secret and callback URL.',
  tiktok_scope_not_approved:'The TikTok app must have the video.upload permission approved before this account can connect.',
  tiktok_authorization_failed:'TikTok authorization could not be completed. Try again.',
  instagram_data_deletion_pending:'Instagram data deletion is in progress. Reconnect after it completes.',
  youtube_reconnect_required:'Reconnect YouTube and grant both channel and upload permissions.',
  instagram_not_configured:'Instagram Business Login is not configured on this server.',
  instagram_reels_not_enabled:'Instagram Reels publishing is still being enabled for your account. You can submit YouTube-only jobs for now.',
  instagram_reconnect_required:'Reconnect your Instagram professional account before publishing.',
  instagram_public_consent_required:'Confirm that this Reel will be published publicly on Instagram.',
  instagram_reel_processing_failed:'Instagram could not process the rendered Reel. Review your video before retrying.',
  instagram_reel_processing_timeout:'Instagram is still processing this Reel. Check status before trying again.',
  instagram_publish_needs_review:'Instagram publication needs manual review. Do not submit again before checking your profile.',
  instagram_claim_expired:'Instagram publication was interrupted. Check your Instagram profile before submitting again.',
  instagram_identity_mismatch:'Instagram returned an unexpected account. Reconnect Instagram and verify the username.',
  instagram_provider_rejected:'Instagram rejected the publishing request. Verify account permissions and the video.',
  instagram_profile_unavailable:'Instagram profile information is unavailable. Reconnect the professional account.',
  instagram_temporarily_unavailable:'Instagram publication could not be confirmed. Check history before trying again.',
  instagram_session_missing:'Your 1CE login session was not available when Instagram returned. Sign in to 1CE and try connecting again.',
  instagram_consent_denied:'Instagram did not return a valid authorization. Start from Connect Instagram again.',
  instagram_code_exchange_failed:'Instagram consent was received, but Meta rejected the authorization exchange. Verify the Instagram App ID, App Secret and registered callback in the existing Meta app.',
  instagram_long_token_failed:'Instagram authorized the account, but Meta could not issue a long-lived token. Verify Instagram API permissions and the Meta app settings.',
  instagram_connection_save_failed:'Instagram authorized the account, but 1CE could not save its connection. Please retry after the service is checked.',
  instagram_state_expired:'Your Instagram authorization expired. Start again from Upload.',
  instagram_authorization_failed:'Instagram authorization failed. Try connecting again.',
  instagram_professional_account_required:'A professional Instagram account (Creator or Business) is required.',
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
  needs_review:'The outcome is uncertain. Check the destination profile before any new submission.',
  publishing_unavailable:'Publishing is unavailable on this server. Please try again later.',
  audio_too_long:'Audio must be 20 minutes or less.',
  cover_too_large:'Use an image up to 15 MiB, 32 megapixels and 8192 pixels per side.',
  unauthorized:'Sign in again to continue.',
  forbidden:'This account does not have permission for this action.'
 };
 return typeof code==='string'&&Object.hasOwn(messages,code)?messages[code]:'Publishing could not complete. Check the destination connection and permissions, then review the job status.';
}
export type PublishingPayload={requestId:string;title:string;description:string;hashtags:string;targets:({platform:'youtube';variant:'shorts'|'standard'}|{platform:'instagram'|'tiktok';variant:'default'})[];audioFileId:number;coverFileId:number;privacy:'private'|'unlisted'|'public';instagramPublicConsent?:boolean;tiktok?:TikTokDraftUpload};
export const canRetryPublishingTarget=(target:PublishingTarget)=>target.platform!=='tiktok'&&['failed','retryable'].includes(target.state)&&!target.remoteId;
export function publishingAuthorizationUrl(api:string,value:unknown):string{
 if(typeof value!=='string')throw Error('Invalid authorization URL');
 const url=new URL(value),backend=new URL(api);
 const validYouTube=url.pathname==='/auth/youtube/start'&&/^pub_[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('state')||'');
 const validInstagram=url.pathname==='/auth/instagram/start'&&/^igpub_[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('state')||'');
 const validTikTok=url.pathname==='/auth/tiktok/start'&&/^ttpub_[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('state')||'');
 if(url.protocol!=='https:'||url.origin!==backend.origin||url.username||url.password||url.hash||
  [...url.searchParams.keys()].length!==1||(!validYouTube&&!validInstagram&&!validTikTok))throw Error('Invalid authorization URL');
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
 if(path==='/status'&&(typeof result.available!=='boolean'||typeof result.connected!=='boolean'||!Array.isArray(result.jobs)||!result.jobs.every((job:Record<string,unknown>)=>job&&typeof job.id==='string'&&typeof job.requestId==='string'&&typeof job.title==='string'&&typeof job.state==='string'&&Array.isArray(job.targets)&&job.targets.every((target:Record<string,unknown>)=>target&&typeof target.id==='string'&&typeof target.state==='string'&&typeof target.platform==='string'&&typeof target.variant==='string'))))throw Error('Invalid publishing status');
 if(path==='/status'&&result.instagram!==undefined){
  const ig=result.instagram;
  if(!ig||typeof ig!=='object'||Array.isArray(ig))throw Error('Invalid Instagram publishing status');
  const data=ig as Record<string,unknown>;
  if(typeof data.available!=='boolean'||typeof data.connected!=='boolean'||
   !(typeof data.username==='string'||data.username===null)||typeof data.publishingEnabled!=='boolean')
   throw Error('Invalid Instagram publishing status');
 }
 if(path==='/status'&&result.tiktok!==undefined){
  const data=result.tiktok as Record<string,unknown>;
  if(!data||typeof data!=='object'||Array.isArray(data)||
   typeof data.available!=='boolean'||typeof data.connected!=='boolean'||
   typeof data.publishingEnabled!=='boolean'||
   (data.nickname!=null&&typeof data.nickname!=='string')||
   (data.connectionId!=null&&(typeof data.connectionId!=='string'||!data.connectionId.trim())))throw Error('Invalid TikTok publishing status');
 }
 if(path==='/jobs'&&(typeof result.id!=='string'||typeof result.state!=='string'))throw Error('Invalid queue response; retry without editing');
 return result as T;
}
