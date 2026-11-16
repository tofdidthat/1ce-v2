import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {settleConfirmedInstagramReel,quarantineExpiredInstagramClaims,runInstagramReelOnce} from '../dist/instagram-reels-worker.js';
import {sealPublishing} from '../dist/publishing-secrets.js';

const claim='7f5f2ac1-b96a-48ef-a0ab-0c22e6e42313';
test('a lost fenced settle after a provider-confirmed Reel becomes manual review, never success',async()=>{
 const calls=[],db={async query(sql,args){calls.push({sql,args});return{rowCount:0,rows:[]}}};
 await assert.rejects(settleConfirmedInstagramReel(db,'19',claim,'17841405309211844'),{code:'instagram_publish_needs_review'});
 assert.equal(calls.length,1);assert.equal(calls[0].args[0],'19');
 assert.equal(calls[0].args[3],'17841405309211844');
});

test('expired Instagram claims are quarantined instead of being blindly replayed',async()=>{
 const calls=[],db={async query(sql,args){calls.push({sql,args});return{rowCount:1,rows:[]}}};
 await quarantineExpiredInstagramClaims(db);
 assert.equal(calls.length,1);assert.match(calls[0].sql,/t\.platform='instagram'/);
 assert.match(calls[0].sql,/t\.state='running' AND t\.claim_until<clock_timestamp\(\)/);
 assert.match(calls[0].sql,/state='needs_review'/);
 assert.match(calls[0].sql,/remote_id=COALESCE/);
});

const owner=42,jobId='11111111-1111-4111-8111-111111111111',generation='22222222-2222-4222-8222-222222222222';
const instagramId='17841405309211844',token='fixture-instagram-access-token';
const config={appId:'fixture-meta-app',appSecret:'fixture-meta-secret',redirectUri:'https://api.invalid/auth/instagram/callback',
 webOrigin:'https://1ce.lol',encryptionSecret:'fixture-publishing-encryption-secret'};
const artifact=Buffer.from('fixture rendered reel'),artifactSha=createHash('sha256').update(artifact).digest('hex');

function workerFixture({connection=true,checkpointWriteFails=false,leaseExpiresAfterPublish=false,publishThrows=false}={}){
 const calls=[],providerCalls={publish:0},state={target:'queued',leaseExpired:false,publishedMediaId:null,targetRemoteId:null};
 const checkpoint={target_id:'19',connection_generation:generation,
  artifact_key:`publishing/users/${owner}/${jobId}/19/${artifactSha}.mp4`,artifact_sha:artifactSha,
  artifact_bytes:artifact.length,container_id:'222',publish_started_at:null,published_media_id:null};
 const db={async query(sql,args=[]){calls.push({sql,args});
  if(sql.includes('WITH candidate AS MATERIALIZED')){
   if(!['queued','retryable'].includes(state.target))return{rowCount:0,rows:[]};
   state.target='running';return{rowCount:1,rows:[{id:'19',job_id:jobId,platform:'instagram',variant:'default',attempts:1}]};
  }
  if(sql.startsWith('SELECT * FROM v2_publication_jobs'))return{rowCount:1,rows:[{id:jobId,user_id:owner,
   audio_file_id:31,cover_file_id:32,instagram_public_confirmed:true,instagram_generation:generation,title:'fixture'}]};
  if(sql.includes('SELECT generation,access_cipher,expires_at,instagram_user_id'))return{rowCount:connection?1:0,
   rows:connection?[{generation,access_cipher:sealPublishing(token,'instagram-access:'+owner,config.encryptionSecret),
    expires_at:new Date(Date.now()+30*86400000).toISOString(),instagram_user_id:instagramId}]:[]};
  if(sql.includes('SELECT t.id FROM v2_publication_targets t'))return{rowCount:1,rows:[{id:'19'}]};
  if(sql.includes('FROM library_files'))return{rowCount:2,rows:[
   {id:31,kind:'audio',object_key:'audio.mp3',byte_size:4,sha256:null},
   {id:32,kind:'cover',object_key:'cover.png',byte_size:4,sha256:null}]};
  if(sql.includes('SELECT * FROM v2_instagram_checkpoints'))return{rowCount:1,rows:[checkpoint]};
  if(sql.startsWith('UPDATE v2_publication_artifacts SET expires_at'))return{rowCount:1,rows:[]};
  if(sql.includes('SET publish_started_at=clock_timestamp()'))return{rowCount:1,rows:[{target_id:'19'}]};
  if(sql.startsWith('UPDATE v2_instagram_checkpoints SET published_media_id')){
   if(checkpointWriteFails)throw Error('synthetic database confirmation failure');
   state.publishedMediaId=args[1];checkpoint.published_media_id=args[1];
   if(leaseExpiresAfterPublish)state.leaseExpired=true;
   return{rowCount:1,rows:[]};
  }
  if(sql.includes('WITH finished AS')){
   if(state.leaseExpired)return{rowCount:0,rows:[]};
   state.target=args[2];state.targetRemoteId=args[3]||null;return{rowCount:1,rows:[]};
  }
  if(sql.includes('WITH stale AS')){
   if(state.target==='running'&&state.leaseExpired){state.target='needs_review';state.targetRemoteId=state.publishedMediaId;return{rowCount:1,rows:[]};}
   return{rowCount:0,rows:[]};
  }
  if(sql.startsWith('UPDATE v2_publication_jobs j SET state=CASE'))return{rowCount:1,rows:[]};
  return{rowCount:1,rows:[]};
 }};
 const storage={bucket:'fixture-bucket',s3:{async send(){return{Body:Readable.from([artifact])}}}};
 const http=async(url)=>{
  const parsed=new URL(String(url));
  if(parsed.pathname.endsWith('/me'))return Response.json({id:instagramId,username:'artist'});
  if(parsed.pathname.endsWith('/222'))return Response.json({status_code:'FINISHED'});
  if(parsed.pathname.endsWith('/media_publish')){
   providerCalls.publish++;
   if(publishThrows)throw Error('synthetic response lost after provider may have accepted');
   return Response.json({id:'333'});
  }
  throw Error('unexpected synthetic Meta request '+parsed.pathname);
 };
 return{db,state,calls,providerCalls,storage,http};
}
async function once(fixture){
 const before=process.env.INSTAGRAM_REELS_ENABLED;process.env.INSTAGRAM_REELS_ENABLED='true';
 try{return await runInstagramReelOnce(fixture.db,{config,storage:fixture.storage,http:fixture.http,render:async()=>{throw Error('checkpoint should reuse rendered asset')}});}
 finally{if(before===undefined)delete process.env.INSTAGRAM_REELS_ENABLED;else process.env.INSTAGRAM_REELS_ENABLED=before;}
}

test('ambiguous worker interruption after media_publish is quarantined and never replayed',async()=>{
 const fixture=workerFixture({publishThrows:true});
 assert.equal(await once(fixture),true);
 assert.equal(fixture.providerCalls.publish,1);assert.equal(fixture.state.target,'needs_review');
 assert.ok(fixture.calls.some(call=>call.sql.includes('WITH finished AS')&&call.args[2]==='needs_review'));
 assert.equal(await once(fixture),false);assert.equal(fixture.providerCalls.publish,1);
});

test('provider confirmation followed by database checkpoint failure becomes needs_review, never a second publish',async()=>{
 const fixture=workerFixture({checkpointWriteFails:true});
 await once(fixture);
 assert.equal(fixture.providerCalls.publish,1);assert.equal(fixture.state.target,'needs_review');
 assert.ok(fixture.calls.some(call=>call.sql.includes('WITH finished AS')&&call.args[2]==='needs_review'));
 assert.ok(fixture.calls.some(call=>call.sql.includes('WITH finished AS')&&call.args[3]==='333'));
 assert.equal(await once(fixture),false);assert.equal(fixture.providerCalls.publish,1);
});

test('expired fenced lease after provider confirmation is quarantined before another claim',async()=>{
 const fixture=workerFixture({leaseExpiresAfterPublish:true});
 await once(fixture);
 assert.equal(fixture.providerCalls.publish,1);assert.equal(fixture.state.target,'running');
 assert.equal(fixture.state.publishedMediaId,'333');
 await quarantineExpiredInstagramClaims(fixture.db);
 assert.equal(fixture.state.target,'needs_review');
 assert.equal(fixture.state.targetRemoteId,'333');
 assert.equal(await once(fixture),false);assert.equal(fixture.providerCalls.publish,1);
});

test('reconnected Instagram account with a new generation cannot run an old queued job',async()=>{
 const fixture=workerFixture({connection:false});let providerRequests=0;
 fixture.http=async()=>{providerRequests++;throw Error('must not contact Meta before matching generation')};
 await once(fixture);
 assert.equal(fixture.state.target,'failed');assert.equal(providerRequests,0);
 const settled=fixture.calls.find(call=>call.sql.includes('WITH finished AS'));
 assert.equal(settled.args[2],'failed');assert.equal(settled.args[4],'instagram_reconnect_required');
 assert.equal(await once(fixture),false);assert.equal(providerRequests,0);
});
