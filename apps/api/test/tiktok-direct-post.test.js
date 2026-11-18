import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryEndpoint,creatorInfo,parseTikTokPreferences,validateCreator} from '../dist/tiktok-direct-post.js';

const prefs={connectionId:'11111111-1111-4111-8111-111111111111',title:'editable caption',privacyLevel:'SELF_ONLY',
 allowComment:false,allowDuet:false,allowStitch:false,ownBrand:false,brandedContent:false,consent:true};
test('posting requires an enabled flag and the verified delivery path on the HTTPS API origin',()=>{
 const env={...process.env};
 try {
  process.env.TIKTOK_REDIRECT_URI='https://qa.invalid/auth/tiktok/callback';
  process.env.TIKTOK_VERIFIED_URL_PREFIX='https://qa.invalid/api/publishing/';
  delete process.env.TIKTOK_DIRECT_POST_ENABLED;
  assert.equal(deliveryEndpoint(),null);
  process.env.TIKTOK_DIRECT_POST_ENABLED='true';
  assert.equal(deliveryEndpoint(),'https://qa.invalid/api/publishing/tiktok-media');
  for(const prefix of ['https://other.invalid/','https://qa.invalid/api/pub','http://qa.invalid/','https://test@qa.invalid/','https://qa.invalid/?x=1']){
   process.env.TIKTOK_VERIFIED_URL_PREFIX=prefix;assert.equal(deliveryEndpoint(),null);
  }
 }finally{for(const k of ['TIKTOK_DIRECT_POST_ENABLED','TIKTOK_REDIRECT_URI','TIKTOK_VERIFIED_URL_PREFIX'])if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}
});
test('commercial disclosure, consent, private accounts and changing creator permissions are enforced',async()=>{
 const audited=process.env.TIKTOK_AUDITED;
 try {
  process.env.TIKTOK_AUDITED='false';
  assert.throws(()=>parseTikTokPreferences({...prefs,consent:false}),/consent_required/);
  assert.throws(()=>parseTikTokPreferences({...prefs,privacyLevel:'PUBLIC_TO_EVERYONE'}),/privacy_invalid/);
  const query=privacy_level_options=>creatorInfo('token',prefs.connectionId,async()=>Response.json({error:{code:'ok'},data:{
   creator_nickname:'qa',creator_username:'qa',privacy_level_options,duet_disabled:true,stitch_disabled:false,
   comment_disabled:true,max_video_post_duration_sec:60}}));
  const privateAccount=await query(['FOLLOWER_OF_CREATOR','SELF_ONLY']);
  assert.deepEqual(privateAccount.privacyLevelOptions,['SELF_ONLY']);
  assert.deepEqual((await query(['PUBLIC_TO_EVERYONE','SELF_ONLY'])).privacyLevelOptions,[]);
  assert.doesNotThrow(()=>validateCreator(prefs,privateAccount));
  for(const key of ['allowComment','allowDuet'])assert.throws(()=>validateCreator({...prefs,[key]:true},privateAccount),/privacy_invalid/);
  process.env.TIKTOK_AUDITED='true';
  for(const level of ['FOLLOWER_OF_CREATOR','SELF_ONLY'])assert.throws(()=>parseTikTokPreferences({...prefs,brandedContent:true,privacyLevel:level}),/privacy_invalid/);
  for(const level of ['PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS'])assert.equal(parseTikTokPreferences({...prefs,privacyLevel:level,brandedContent:true}).brandedContent,true);
 }finally{if(audited===undefined)delete process.env.TIKTOK_AUDITED;else process.env.TIKTOK_AUDITED=audited;}
});
