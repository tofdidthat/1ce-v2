import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryEndpoint,parseTikTokDraftConsent,tikTokPost,TikTokDraftRejected} from '../dist/tiktok-draft-upload.js';

const consent={connectionId:'11111111-1111-4111-8111-111111111111',consent:true};
test('draft delivery requires opt-in and a verified HTTPS media path on a configured origin',()=>{
 const keys=['TIKTOK_DRAFT_UPLOAD_ENABLED','TIKTOK_REDIRECT_URI','TIKTOK_VERIFIED_URL_PREFIX','WEB_ORIGIN'];
 const env={...process.env};
 try {
  process.env.TIKTOK_REDIRECT_URI='https://api.invalid/auth/tiktok/callback';
  process.env.WEB_ORIGIN='https://qa.invalid';
  process.env.TIKTOK_VERIFIED_URL_PREFIX='https://api.invalid/api/publishing/';
  delete process.env.TIKTOK_DRAFT_UPLOAD_ENABLED;
  assert.equal(deliveryEndpoint(),null);
  process.env.TIKTOK_DRAFT_UPLOAD_ENABLED='true';
  assert.equal(deliveryEndpoint(),'https://api.invalid/api/publishing/tiktok-media');
  process.env.TIKTOK_VERIFIED_URL_PREFIX='https://qa.invalid/api/publishing/';
  assert.equal(deliveryEndpoint(),'https://qa.invalid/api/publishing/tiktok-media');
  for(const prefix of ['https://other.invalid/','https://qa.invalid/api/pub','http://qa.invalid/','https://test@qa.invalid/','https://qa.invalid/?x=1']){
   process.env.TIKTOK_VERIFIED_URL_PREFIX=prefix;
   assert.equal(deliveryEndpoint(),null);
  }
  delete process.env.TIKTOK_VERIFIED_URL_PREFIX;
  assert.equal(deliveryEndpoint(),null);
  process.env.WEB_ORIGIN='https://1ce.lol';
  assert.equal(deliveryEndpoint(),'https://1ce.lol/api/publishing/tiktok-media');
 } finally {
  for(const key of keys)if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];
 }
});
test('draft consent requires the current connection id and rejects legacy post preferences',()=>{
 assert.deepEqual(parseTikTokDraftConsent(consent),consent);
 for(const value of [null,{...consent,consent:false},{...consent,connectionId:'open_id'},{...consent,privacyLevel:'SELF_ONLY'}])
  assert.throws(()=>parseTikTokDraftConsent(value),/tiktok_consent_required/);
});
test('only documented init rejections with matching HTTP status prove a draft did not start',async()=>{
 const init=(code,status,data)=>tikTokPost('inbox/video/init','fixture-token',{},async url=>{
  assert.equal(url,'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/');
  return Response.json({error:{code},data},{status});
 });
 await assert.rejects(init('spam_risk_too_many_pending_share',403),error=>
  error instanceof TikTokDraftRejected&&error.code==='tiktok_pending_drafts_limit');
 await assert.rejects(init('rate_limit_exceeded',429),error=>
  error instanceof TikTokDraftRejected&&error.status===429);
 for(const reply of [['rate_limit_exceeded',503],['unknown',429],['rate_limit_exceeded',429,{publish_id:'sent'}]])
  await assert.rejects(init(...reply),error=>!(error instanceof TikTokDraftRejected));
});
