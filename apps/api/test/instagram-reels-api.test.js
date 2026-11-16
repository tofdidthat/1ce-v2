import test from 'node:test';
import assert from 'node:assert/strict';
import {createInstagramReel,instagramReelStatus,publishInstagramReel,trustedInstagramDeliveryUrl,resolveInstagramPublishingAccount} from '../dist/instagram-reels-api.js';

const origin='https://1ce-v2-production.up.railway.app';
const mediaUrl=origin+'/api/publishing/meta-media?token='+'a'.repeat(43);
test('private delivery URL rejects arbitrary provider fetch destinations',()=>{
 assert.equal(trustedInstagramDeliveryUrl(mediaUrl,origin),mediaUrl);
 for(const invalid of ['https://evil.invalid/vid.mp4','http://1ce-v2-production.up.railway.app/api/publishing/meta-media?token='+'a'.repeat(43),
 mediaUrl+'&access_token=leak',origin+'/secret?token='+'a'.repeat(43),origin+'/api/publishing/meta-media?token=short'])
  assert.throws(()=>trustedInstagramDeliveryUrl(invalid,origin));
});
test('Meta Graph creates REELS container with bearer header and exact unrounded ID',async()=>{
 const calls=[];
 const http=async(url,options)=>{calls.push({url,options});
  return new Response('{"id":17841405309211844,"ignored":"ok"}',{status:200})};
 const id=await createInstagramReel({accountId:'28621378697485455',token:'fixture-token',videoUrl:mediaUrl,apiOrigin:origin,caption:'My beat #producer',http});
 assert.equal(id,'17841405309211844');
 assert.equal(calls[0].url,'https://graph.instagram.com/v27.0/28621378697485455/media');
 assert.equal(calls[0].options.headers.Authorization,'Bearer fixture-token');
 assert.deepEqual(JSON.parse(calls[0].options.body),{media_type:'REELS',video_url:mediaUrl,caption:'My beat #producer'});
 assert.equal(calls[0].options.redirect,'error');
});
test('Meta processing status is polled without posting media',async()=>{
 const calls=[],http=async(url,options)=>{calls.push({url,options});return Response.json({status_code:'FINISHED'})};
 assert.equal(await instagramReelStatus({containerId:'17841405309211844',token:'fixture-token',http}),'FINISHED');
 assert.equal(calls[0].options.method,'GET');assert.match(calls[0].url,/status_code,status$/);
});
test('publish posts only the confirmed container and preserves long media IDs',async()=>{
 const calls=[],http=async(url,options)=>{calls.push({url,options});return new Response('{"id":"18800001234567891"}')};
 const id=await publishInstagramReel({accountId:'28621378697485455',containerId:'17841405309211844',token:'fixture-token',http});
 assert.equal(id,'18800001234567891');assert.match(calls[0].url,/media_publish$/);
 assert.deepEqual(JSON.parse(calls[0].options.body),{creation_id:'17841405309211844'});
});
test('provider errors do not leak credentials or body into errors',async()=>{
 await assert.rejects(createInstagramReel({accountId:'28621378697485455',token:'secret-token-fixture',videoUrl:mediaUrl,apiOrigin:origin,caption:'safe',
  http:async()=>new Response('{"error":{"message":"private-provider-diagnostic"}}',{status:403})}),
  error=>{assert.equal(error.code,'instagram_provider_rejected');assert.doesNotMatch(String(error),/secret-token|private-provider-diagnostic/);return true;});
});

test('resolve Instagram publishing ID from /me user_id without losing precision',async()=>{
 const http=async()=>new Response('{"id":17841405309211844,"user_id":28621378697485455,"username":"producer"}');
 assert.equal(await resolveInstagramPublishingAccount({token:'x',oauthUserId:'17841405309211844',http}),
  '28621378697485455');
 assert.equal(await resolveInstagramPublishingAccount({token:'x',oauthUserId:'28621378697485455',http}),
  '28621378697485455');
 await assert.rejects(resolveInstagramPublishingAccount({token:'x',oauthUserId:'11111111111111111',http}),
  {code:'instagram_identity_mismatch'});
});
