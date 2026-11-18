import test from 'node:test';
import assert from 'node:assert/strict';
import {tiktokDraftForSubmission} from '../src/tiktok-draft-v2.ts';
import {canRetryPublishingTarget} from '../src/publishing-api-v2.ts';

test('TikTok draft payload requires consent and the current account generation',()=>{
 assert.equal(tiktokDraftForSubmission('generation',30,false),null);
 for(const connectionId of [null,undefined,'']){
  assert.equal(tiktokDraftForSubmission(connectionId,30,true),null);
 }
 assert.deepEqual(tiktokDraftForSubmission('generation',30,true),{connectionId:'generation',consent:true});
});

test('TikTok draft duration must be known and between 3 and 180 seconds',()=>{
 for(const duration of [null,NaN,Infinity,0,2.99,180.01]){
  assert.equal(tiktokDraftForSubmission('generation',duration,true),null);
 }
 for(const duration of [3,180]){
  assert.deepEqual(tiktokDraftForSubmission('generation',duration,true),{connectionId:'generation',consent:true});
 }
});

test('TikTok draft targets cannot be manually requeued through the generic history action',()=>{
 for(const state of ['needs_review','retryable','failed','succeeded']){
  assert.equal(canRetryPublishingTarget({platform:'tiktok',state}),false);
 }
 assert.equal(canRetryPublishingTarget({platform:'youtube',state:'retryable'}),true);
});
