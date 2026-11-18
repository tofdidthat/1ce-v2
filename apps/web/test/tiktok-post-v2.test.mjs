import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {isTikTokCreatorInfo,emptyTikTokDraft,tiktokPostForSubmission} from '../src/tiktok-post-v2.ts';
import {canRetryPublishingTarget,publishingRequest} from '../src/publishing-api-v2.ts';

const creator={
 connectionId:'connection-generation',nickname:'Artist',username:'artist',
 privacyLevelOptions:['SELF_ONLY','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR'],
 commentDisabled:false,duetDisabled:true,stitchDisabled:false,maxVideoPostDurationSec:60
};

test('TikTok requires explicit privacy, consent and a known duration within the creator limit',()=>{
 const draft={...emptyTikTokDraft,title:' TikTok caption ',privacyLevel:'SELF_ONLY'};
 assert.equal(tiktokPostForSubmission(creator,emptyTikTokDraft,30,true),null);
 assert.equal(tiktokPostForSubmission(creator,draft,30,false),null);
 assert.equal(tiktokPostForSubmission(null,draft,30,true),null);
 for(const duration of [null,NaN,Infinity,0,2.99,60.01]){
  assert.equal(tiktokPostForSubmission(creator,draft,duration,true),null);
 }
 assert.equal(tiktokPostForSubmission({...creator,maxVideoPostDurationSec:300},draft,180.01,true),null);
 assert.deepEqual(tiktokPostForSubmission(creator,draft,60,true),{
  connectionId:creator.connectionId,title:'TikTok caption',privacyLevel:'SELF_ONLY',
  allowComment:false,allowDuet:false,allowStitch:false,ownBrand:false,brandedContent:false,consent:true
 });
});

test('TikTok honors API privacy and interaction restrictions and commercial disclosure',()=>{
 const draft={...emptyTikTokDraft,privacyLevel:'SELF_ONLY'};
 assert.equal(tiktokPostForSubmission(creator,{...draft,privacyLevel:'PUBLIC_TO_EVERYONE'},30,true),null);
 assert.equal(tiktokPostForSubmission(creator,{...draft,allowDuet:true},30,true),null);
 assert.equal(tiktokPostForSubmission(creator,{...draft,discloseCommercial:true},30,true),null);
 const branded={...draft,discloseCommercial:true,brandedContent:true};
 assert.equal(tiktokPostForSubmission(creator,branded,30,true),null);
 assert.equal(tiktokPostForSubmission(creator,{...branded,privacyLevel:'FOLLOWER_OF_CREATOR'},30,true),null);
 assert.equal(tiktokPostForSubmission(creator,{...branded,privacyLevel:'MUTUAL_FOLLOW_FRIENDS'},30,true)?.brandedContent,true);
 assert.equal(tiktokPostForSubmission(creator,{...draft,discloseCommercial:true,ownBrand:true},30,true)?.ownBrand,true);
});

test('creator options are authenticated, uncached and validated before reaching the form',async t=>{
 const api='https://api.invalid';
 const signal=new AbortController().signal;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,api+'/api/publishing/tiktok/creator-info');
  assert.equal(options.method,'GET');
  assert.equal(options.credentials,'include');
  assert.equal(options.cache,'no-store');
  assert.equal(options.signal,signal);
  return Response.json(creator);
 });
 assert.deepEqual(await publishingRequest(api,'/tiktok/creator-info',signal),creator);
 for(const change of [{privacyLevelOptions:['UNKNOWN']},{maxVideoPostDurationSec:0},{nickname:''},{duetDisabled:'false'},{connectionId:null}]){
  assert.equal(isTikTokCreatorInfo({...creator,...change}),false);
 }
 globalThis.fetch.mock.mockImplementation(async()=>Response.json({...creator,maxVideoPostDurationSec:null}));
 await assert.rejects(publishingRequest(api,'/tiktok/creator-info',signal),/Invalid TikTok creator options/);
 globalThis.fetch.mock.mockImplementation(async()=>Response.json({error:'tiktok_rate_limited'},{status:429}));
 await assert.rejects(publishingRequest(api,'/tiktok/creator-info',signal),/Try again later/);
});

test('TikTok targets cannot be manually requeued through the generic history action',()=>{
 for(const state of ['needs_review','retryable','failed','succeeded']){
  assert.equal(canRetryPublishingTarget({platform:'tiktok',state}),false);
 }
 assert.equal(canRetryPublishingTarget({platform:'youtube',state:'retryable'}),true);
});

test('TikTok settings render the account, unselected privacy and disabled interactions',async()=>{
 const compiled=await build({
  entryPoints:[fileURLToPath(new URL('../src/tiktok-post-options-v2.tsx',import.meta.url))],
  bundle:true,jsx:'automatic',write:false,platform:'node',external:['react','react/jsx-runtime']
 });
 const module={exports:{}};
 new Function('module','require',compiled.outputFiles[0].text)(module,createRequire(import.meta.url));
 const props={creator,draft:emptyTikTokDraft,duration:30,hasAudio:true,consent:false,onChange(){},onConsent(){}};
 const html=renderToStaticMarkup(createElement(module.exports.default,props));
 assert.match(html,/Posting to Artist \(@artist\)/);
 assert.match(html,/<option value="" disabled="" selected="">Choose who can watch/);
 assert.doesNotMatch(html,/PUBLIC_TO_EVERYONE|checked=|Branded Content Policy/);
 assert.match(html,/type="checkbox" disabled=""\/>Duet/);
 assert.match(html,/Music Usage Confirmation/);
 const branded=renderToStaticMarkup(createElement(module.exports.default,{
  ...props,draft:{...emptyTikTokDraft,discloseCommercial:true,brandedContent:true}
 }));
 assert.match(branded,/<option value="SELF_ONLY" disabled=""/);
 assert.match(branded,/Branded Content Policy/);
 assert.match(branded,/Paid partnership/);
});
