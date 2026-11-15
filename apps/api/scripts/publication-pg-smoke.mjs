// R03 durable queue acceptance in disposable CI PostgreSQL only.
// No R2, YouTube, account OAuth, credentials or production data are accessed.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createPublicationDraft,claimPublicationTarget,settlePublicationTarget,
 quarantineExpiredPublicationClaims} from '../dist/publication-queue.js';
const u=process.env.S2_TEST_DATABASE_URL?new URL(process.env.S2_TEST_DATABASE_URL):null;
if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||!u||
 !['postgres:','postgresql:'].includes(u.protocol)||
 !['localhost','127.0.0.1'].includes(u.hostname)||
 u.port!=='5432'||u.pathname!=='/onece_s2_ci')
 throw Error('Refusing a publication queue smoke outside disposable CI PostgreSQL');
const db=new pg.Pool({connectionString:u.href,max:8,connectionTimeoutMillis:5000});
const migration=await readFile(new URL('../../../history/database/016_publication_queue.sql',import.meta.url),'utf8');
let ownerA=null,ownerB=null;
const draft=(requestId=randomUUID())=>({requestId,title:'Sample beat',description:'Original test audio',
 hashtags:'#original',targets:[
  {platform:'youtube',variant:'shorts'},
  {platform:'youtube',variant:'standard'},
  {platform:'tiktok',variant:'default'}
 ]});
try{
 await db.query(migration);
 await db.query(migration); // Idempotent schema.
 ownerA=(await db.query('INSERT INTO account_users(email) VALUES($1) RETURNING id',
  ['pub-a-'+randomUUID()+'@ci.invalid'])).rows[0].id;
 ownerB=(await db.query('INSERT INTO account_users(email) VALUES($1) RETURNING id',
  ['pub-b-'+randomUUID()+'@ci.invalid'])).rows[0].id;
 const input=draft();
 const concurrent=await Promise.all(Array.from({length:5},()=>createPublicationDraft(db,ownerA,input)));
 assert.equal(new Set(concurrent.map(r=>r.id)).size,1,'Concurrent idempotency');
 assert.equal(concurrent.filter(r=>r.created).length,1,'One writer creates job');
 const jobId=concurrent[0].id;
 const foreign=await createPublicationDraft(db,ownerB,input);
 assert.notEqual(foreign.id,jobId,'Request nonce is unique PER OWNER, not globally');
 await assert.rejects(()=>createPublicationDraft(db,ownerA,{...input,title:'Changed title'}),/already used/);
 const owners=await db.query('SELECT user_id FROM v2_publication_jobs WHERE id=$1',[jobId]);
 assert.equal(owners.rows[0].user_id,ownerA);
 let rows=await db.query('SELECT id,platform,variant,state FROM v2_publication_targets WHERE job_id=$1 ORDER BY id',[jobId]);
 assert.equal(rows.rows.length,3);
 assert.ok(rows.rows.every(row=>row.state==='draft'));
 assert.equal(await claimPublicationTarget(db),null,'Draft cannot be published');
 // Emulate a FUTURE, separately verified media/OAuth acceptance step.
 // This is not implemented as an API route and never called in production here.
 await db.query("UPDATE v2_publication_jobs SET state='ready' WHERE id=$1",[jobId]);
 await db.query("UPDATE v2_publication_targets SET state='queued' WHERE job_id=$1",[jobId]);
 const claims=await Promise.all(Array.from({length:6},()=>claimPublicationTarget(db)));
 const running=claims.filter(Boolean);
 assert.equal(running.length,3,'SKIP LOCKED never claims a task twice');
 assert.equal(new Set(running.map(c=>c.id)).size,3);
 assert.ok(running.every(c=>c.attempt===1));
 const byVariant=Object.fromEntries(running.map(c=>[c.platform+':'+c.variant,c]));
 const success=byVariant['youtube:shorts'];
 assert.equal(await settlePublicationTarget(db,success.id,randomUUID(),'succeeded',{remoteId:'fake_video'}),false,'Stale token rejected');
 assert.equal(await settlePublicationTarget(db,success.id,success.claimToken,'succeeded',{remoteId:'fake_video'}),true);
 assert.equal(await settlePublicationTarget(db,success.id,success.claimToken,'succeeded',{remoteId:'fake_video'}),false,'One terminal outcome');
 const retry=byVariant['tiktok:default'];
 assert.equal(await settlePublicationTarget(db,retry.id,retry.claimToken,'retryable',{errorCode:'provider_503'}),true);
 const delayed=await db.query('SELECT state,next_attempt_at>now() AS delayed FROM v2_publication_targets WHERE id=$1',[retry.id]);
 assert.equal(delayed.rows[0].state,'retryable');assert.equal(delayed.rows[0].delayed,true);
 // Expired running lease is not requeued: provider may have accepted the upload.
 const ambiguous=byVariant['youtube:standard'];
 await db.query("UPDATE v2_publication_targets SET claim_until=clock_timestamp()-interval '1 second' WHERE id=$1",[ambiguous.id]);
 assert.equal(await settlePublicationTarget(db,ambiguous.id,ambiguous.claimToken,'succeeded',{remoteId:'unknown'}),false);
 assert.equal(await quarantineExpiredPublicationClaims(db),1);
 const isolated=await db.query('SELECT state,last_error_code FROM v2_publication_targets WHERE id=$1',[ambiguous.id]);
 assert.deepEqual(isolated.rows[0],{state:'needs_review',last_error_code:'claim_expired'});
 assert.equal(await quarantineExpiredPublicationClaims(db),0);
 await db.query("UPDATE v2_publication_targets SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",[retry.id]);
 const resumed=await claimPublicationTarget(db);
 assert.equal(resumed.id,retry.id);assert.equal(resumed.attempt,2);
 assert.equal(await settlePublicationTarget(db,resumed.id,resumed.claimToken,'needs_review',{errorCode:'unknown_ack'}),true);
 assert.equal(await claimPublicationTarget(db),null,'Succeeded or ambiguous targets are never automatically resent');
 const audit=await db.query('SELECT target_id,attempt,outcome FROM v2_publication_attempts WHERE target_id=$1 ORDER BY attempt',[retry.id]);
 assert.deepEqual(audit.rows.map(x=>[x.attempt,x.outcome]),[[1,'retryable'],[2,'needs_review']]);
 const ownerBSafeguard=await db.query('SELECT COUNT(*)::int AS count FROM v2_publication_targets t JOIN v2_publication_jobs j ON j.id=t.job_id WHERE j.user_id=$1 AND t.state<>$2',[ownerB,'draft']);
 assert.equal(ownerBSafeguard.rows[0].count,0,'Other owner untouched');
 await db.query('DELETE FROM v2_publication_jobs WHERE id=$1',[jobId]);
 assert.equal((await db.query('SELECT 1 FROM v2_publication_attempts WHERE target_id=$1',[retry.id])).rowCount,0,'Cascade removes attempt ledger');
 console.log('Publication PG PASS: schema idempotency; owner isolation; atomic claims; stale-token fencing; success, backoff, manual review; no external services.');
}finally{
 if(ownerA)await db.query('DELETE FROM account_users WHERE id=$1',[ownerA]);
 if(ownerB)await db.query('DELETE FROM account_users WHERE id=$1',[ownerB]);
 await db.end();
}
