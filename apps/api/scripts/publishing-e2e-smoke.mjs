// Real disposable PostgreSQL + filesystem, simulated R2/Google. Never publishes.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {writeFile} from 'node:fs/promises';
import pg from 'pg';
import {ensurePublishingSchema} from '../dist/publishing-schema.js';
import {enqueuePublication,listPublications,retryPublication} from '../dist/publishing-jobs.js';
import {runPublicationOnce,recoverYouTubeClaims} from '../dist/publication-worker.js';
import {claimPublicationTarget} from '../dist/publication-queue.js';
import {sealPublishing} from '../dist/publishing-secrets.js';
const url=process.env.S2_TEST_DATABASE_URL?new URL(process.env.S2_TEST_DATABASE_URL):null;
if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||!url||!['postgres:','postgresql:'].includes(url.protocol)||
 !['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='5432'||url.pathname!=='/onece_s2_ci')throw Error('Disposable CI database required');
const db=new pg.Pool({connectionString:url.href,max:8});
const config={clientId:'fixture-client',clientSecret:'fixture-not-real-client-secret',redirectUri:'https://api.invalid/auth/google/callback',
 webOrigin:'https://web.invalid',encryptionSecret:'fixture-not-real-encryption-secret'};
const objects=new Map(),sessions=new Map();let owner,other,mediaRequests=0,sessionRequests=0,renderCalls=0,loseNext=false,privacyOverride=null;
const hash=value=>createHash('sha256').update(value).digest('hex');
const storage={bucket:'never-real-r2',s3:{async send(command){
 const input=command.input,name=command.constructor.name;
 if(name==='GetObjectCommand'){assert.ok(objects.has(input.Key),'Only fixture objects may be read');return {Body:Readable.from([objects.get(input.Key)])};}
 if(name==='PutObjectCommand'){
  assert.match(input.Key,/^publishing\/users\//);const buffers=[];for await(const chunk of input.Body)buffers.push(chunk);
  objects.set(input.Key,Buffer.concat(buffers));return {};
 }
 if(name==='DeleteObjectCommand'){assert.match(input.Key,/^publishing\/users\//);objects.delete(input.Key);return {};}
 throw Error('Unexpected storage command');
}}};
const http=async(raw,init={})=>{
 const url=new URL(raw);
 if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'fixture-access'});
 assert.equal(url.hostname,'www.googleapis.com','Never call an external provider');
 if(url.pathname==='/youtube/v3/videos'){
  const session=[...sessions.values()].find(s=>s.videoId===url.searchParams.get('id'));
  return Response.json({items:[{id:session.videoId,status:{privacyStatus:privacyOverride||session.privacy,uploadStatus:'uploaded'}}]});
 }
 if(init.method==='POST'){
  sessionRequests++;const id='session-'+sessionRequests;
  sessions.set(id,{bytes:Number(init.headers['X-Upload-Content-Length']),received:0,videoId:'fixtureVid_'+sessionRequests,privacy:JSON.parse(init.body).status.privacyStatus});
  return new Response(null,{status:200,headers:{Location:'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id='+id}});
 }
 const session=sessions.get(url.searchParams.get('upload_id'));assert.ok(session);
 if(init.headers['Content-Range'].startsWith('bytes */')){
  return session.received===session.bytes?Response.json({id:session.videoId}):new Response(null,{status:308,
   headers:session.received?{Range:'bytes=0-'+(session.received-1)}:{}});
 }
 mediaRequests++;session.received+=init.body.length;assert.equal(session.received,session.bytes);
 if(loseNext){loseNext=false;throw Error('Fixture: provider accepted bytes, acknowledgement lost');}
 return Response.json({id:session.videoId},{status:201});
};
const options={config,storage,http,render:async({output,variant})=>{renderCalls++;await writeFile(output,Buffer.from('synthetic-render-'+variant));}};
async function file(kind){
 const bytes=Buffer.from('synthetic-'+kind),key=`users/${owner}/assets/${kind}/verified/${randomUUID()}.${kind==='audio'?'mp3':'png'}`;
 objects.set(key,bytes);
 return Number((await db.query(`INSERT INTO library_files(user_id,kind,object_key,original_name,content_type,byte_size,status,sha256)
  VALUES($1,$2,$3,$4,$5,$6,'ready',$7) RETURNING id`,[owner,kind,key,'synthetic',kind==='audio'?'audio/mpeg':'image/png',bytes.length,hash(bytes)])).rows[0].id);
}
try{
 await ensurePublishingSchema(db);
 owner=(await db.query('INSERT INTO account_users(email) VALUES($1) RETURNING id',[`publishing-${randomUUID()}@ci.invalid`])).rows[0].id;
 other=(await db.query('INSERT INTO account_users(email) VALUES($1) RETURNING id',[`publishing-other-${randomUUID()}@ci.invalid`])).rows[0].id;
 const generation=randomUUID();
 for(const user of [owner,other])await db.query(`INSERT INTO v2_youtube_connections(user_id,refresh_cipher,channel_id,channel_title,generation)
  VALUES($1,$2,$3,'Fixture channel',$4::uuid)`,[user,sealPublishing('fixture-refresh','youtube-refresh:'+user,config.encryptionSecret),'UC'+'a'.repeat(22),user===owner?generation:randomUUID()]);
 const input={requestId:randomUUID(),title:'Fixture publication',description:'Synthetic only',hashtags:'',privacy:'private',
  audioFileId:await file('audio'),coverFileId:await file('cover'),targets:[{platform:'youtube',variant:'shorts'},{platform:'youtube',variant:'standard'}]};
 const job=await enqueuePublication(db,owner,input);
 assert.equal((await enqueuePublication(db,owner,input)).id,job.id,'Lost client response cannot duplicate job');
 await assert.rejects(enqueuePublication(db,owner,{...input,privacy:'public'}),/request_id_conflict/);
 await assert.rejects(enqueuePublication(db,other,{...input,requestId:randomUUID()}),/owned_ready_media_required/);
 assert.deepEqual(await listPublications(db,other),[],'History remains account-scoped');
 assert.equal(await runPublicationOnce(db,options),true,'Runs without any browser client');
 loseNext=true;assert.equal(await runPublicationOnce(db,options),true);
 let targets=(await listPublications(db,owner))[0].targets;
 assert.equal(targets.filter(t=>t.state==='succeeded').length,1);
 assert.equal(targets.filter(t=>t.state==='retryable').length,1);
 assert.equal([...objects.keys()].filter(k=>k.startsWith('publishing/')).length,1,'Ambiguous upload retains resumable artifact');
 const retry=targets.find(t=>t.state==='retryable');
 assert.equal(await retryPublication(db,other,retry.id),false);
 assert.equal(await retryPublication(db,owner,targets.find(t=>t.state==='succeeded').id),false);
 assert.equal(await retryPublication(db,owner,retry.id),true);
 assert.equal(await runPublicationOnce(db,options),true);
 targets=(await listPublications(db,owner))[0].targets;assert.ok(targets.every(t=>t.state==='succeeded'));
 assert.equal(sessionRequests,2,'Resume must probe SAME two sessions, never create a third video');
 assert.equal(mediaRequests,2,'Lost final ACK must not resend completed media');assert.equal(renderCalls,2,'Persisted artifact survives executor restart');
 assert.equal([...objects.keys()].filter(k=>k.startsWith('publishing/')).length,0,'Completed artifacts cleaned, original media preserved');
 const restart=await enqueuePublication(db,owner,{...input,requestId:randomUUID(),targets:[input.targets[0]]});
 const abandoned=await claimPublicationTarget(db,'youtube');assert.equal(abandoned.jobId,restart.id);
 await db.query("UPDATE v2_publication_targets SET claim_until=clock_timestamp()-interval '1 second' WHERE id=$1",[abandoned.id]);
 await recoverYouTubeClaims(db);assert.equal(await runPublicationOnce(db,options),true);
 const audit=(await db.query('SELECT outcome FROM v2_publication_attempts WHERE target_id=$1 ORDER BY attempt',[abandoned.id])).rows;
 assert.deepEqual(audit.map(a=>a.outcome),['retryable','succeeded'],'Expired process claim resumes and retains attempt ledger');
 privacyOverride='private';
 const restricted=await enqueuePublication(db,owner,{...input,requestId:randomUUID(),privacy:'public',targets:[input.targets[0]]});
 await runPublicationOnce(db,options);
 const review=(await listPublications(db,owner)).find(j=>j.id===restricted.id).targets[0];
 assert.equal(review.state,'needs_review');assert.ok(review.remoteId);assert.equal(await retryPublication(db,owner,review.id),false);
 console.log('Publishing E2E PASS: owner isolation, durable acceptance, idempotency, two formats, partial failure, lost final acknowledgement, same-session recovery, expired claim recovery, privacy restriction, artifact cleanup. PostgreSQL/filesystem real; R2/Google simulated; zero external publishing.');
}finally{
 if(owner){await db.query('DELETE FROM v2_publication_artifacts WHERE user_id=$1',[owner]);await db.query('DELETE FROM account_users WHERE id=$1',[owner]);}
 if(other)await db.query('DELETE FROM account_users WHERE id=$1',[other]);
 await db.end();
}
