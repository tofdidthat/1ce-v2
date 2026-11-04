// PR #27 additive migration gate. Only executes against an ephemeral localhost
// PostgreSQL database named onece_s2_ci. Never connect this script to production.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import pg from 'pg';
import {Readable} from 'node:stream';
import {rateLimitExceeded,pruneExpiredRateLimits} from '../dist/api-rate-limits.js';
import {accountStorageQuota,GIB} from '../dist/storage-plans.js';
import {acquireCompletionLease,failPendingWithLease,discardPendingWithLease,promoteReadyWithLease} from '../src/upload-leases.js';
import {moveProjectToTrash,purgeTrashMetadata,handleTrash} from '../src/trash.js';

const connectionString=process.env.S2_TEST_DATABASE_URL;
if(!connectionString)throw new Error('S2_TEST_DATABASE_URL is required');
const u=new URL(connectionString);
if(!['postgres:','postgresql:'].includes(u.protocol)||
 !['localhost','127.0.0.1','::1','[::1]'].includes(u.hostname)||
 u.pathname!=='/onece_s2_ci')throw new Error('S2 smoke only runs against local onece_s2_ci');
const dir=resolve(dirname(fileURLToPath(import.meta.url)),'../../../history/database');
const migration=async name=>readFile(resolve(dir,name),'utf8');
const authSql=await migration('001_auth_initial_schema.sql');
const fileSql=await migration('003_library_files_r2.sql');
const collectionsSql=await migration('004_library_collections.sql');
const publicSql=await migration('004_public_profiles.sql');
const dedupSql=await migration('005_library_asset_dedup.sql');
const visibilitySql=await migration('006_library_standalone_visibility.sql');
const trashSql=await migration('012_trash_and_r2_delete_outbox.sql');
const sql=await migration('010_api_rate_limits.sql');
const plansSql=await migration('011_storage_plans_completion_leases.sql');
const pool=new pg.Pool({connectionString,max:8,connectionTimeoutMillis:5000});
try{
 // Base schema is created ONLY in this disposable local PostgreSQL database.
 await pool.query(authSql);
 await pool.query(fileSql);
 await pool.query(collectionsSql);
 await pool.query(publicSql);
 await pool.query(dedupSql);
 await pool.query(visibilitySql);
 // Reapplying both additive S2 migrations must be harmless.
 await pool.query(sql);
 await pool.query(sql);
 await pool.query(plansSql);
 await pool.query(plansSql);
 await pool.query(trashSql);
 await pool.query(trashSql);
 const table=await pool.query("SELECT to_regclass('public.v2_api_rate_limits')::text AS name");
 if(table.rows[0]?.name!=='v2_api_rate_limits')throw Error('Throttle table missing');
 const index=await pool.query("SELECT to_regclass('public.v2_api_rate_limits_window_idx')::text AS name");
 if(index.rows[0]?.name!=='v2_api_rate_limits_window_idx')throw Error('Throttle index missing');
 const concurrent=await Promise.all(Array.from({length:30},()=>rateLimitExceeded(pool,'s2-smoke','demo@example.test',20,15)));
 if(concurrent.filter(Boolean).length!==10)throw Error('Non-atomic shared limiter: '+JSON.stringify(concurrent));
 const query=await pool.query("SELECT subject_hash,hits FROM v2_api_rate_limits WHERE scope='s2-smoke'");
 if(query.rows.length!==1||query.rows[0].hits!==30||
  query.rows[0].subject_hash.includes('@'))throw Error('Hashed subject or counter mismatch');
 await pool.query("UPDATE v2_api_rate_limits SET window_started_at=now()-interval '16 minutes' WHERE scope='s2-smoke'");
 if(await rateLimitExceeded(pool,'s2-smoke','demo@example.test',20,15))throw Error('Expired window not reset');
 const reset=await pool.query("SELECT hits FROM v2_api_rate_limits WHERE scope='s2-smoke'");
 if(reset.rows[0].hits!==1)throw Error('Unexpected reset count');
 const account=await pool.query("INSERT INTO account_users(email) VALUES('s2-plan-demo@example.test') RETURNING id");
 const id=account.rows[0].id;
 if(await accountStorageQuota(pool,id)!==10*GIB)throw Error('Default 10GiB plan missing');
 await pool.query("INSERT INTO v2_storage_plans(code,storage_limit_bytes) VALUES('ci_custom', $1)",[40*GIB]);
 await pool.query("INSERT INTO v2_account_storage_plans(user_id,plan_code) VALUES($1,'ci_custom')",[id]);
 if(await accountStorageQuota(pool,id)!==40*GIB)throw Error('Assigned plan not enforced');
 const other=await pool.query("INSERT INTO account_users(email) VALUES('s2-other@example.test') RETURNING id");
 if(await accountStorageQuota(pool,other.rows[0].id)!==10*GIB)
  throw Error('Unassigned account leaked another plan');
 const asset=await pool.query(`INSERT INTO library_files(user_id,kind,object_key,original_name,content_type,byte_size,status)
  VALUES($1,'audio','ci/object','ci.mp3','audio/mpeg',64,'pending') RETURNING id`,[id]);
 const fileId=asset.rows[0].id;
 const tokenA='11111111-1111-4111-8111-111111111111';
 const tokenB='22222222-2222-4222-8222-222222222222';
 const leaseQuery=`INSERT INTO v2_upload_completion_leases(file_id,lease_token,expires_at)
 VALUES($1,$2::uuid,now()+interval '10 minutes')
 ON CONFLICT(file_id) DO UPDATE SET lease_token=EXCLUDED.lease_token,
 expires_at=EXCLUDED.expires_at
 WHERE v2_upload_completion_leases.expires_at < now()
 RETURNING lease_token`;
 const leases=await Promise.all([pool.query(leaseQuery,[fileId,tokenA]),pool.query(leaseQuery,[fileId,tokenB])]);
 if(leases.filter(x=>x.rowCount===1).length!==1)
  throw Error('Two concurrent owners acquired the same upload lease');
 const winner=leases.find(x=>x.rowCount===1).rows[0].lease_token;
 const loser=winner===tokenA?tokenB:tokenA;
 if((await failPendingWithLease(pool,{fileId,ownerId:id,token:loser})).rowCount!==0)
  throw Error('Non-owner marked an active upload as failed');
 if((await discardPendingWithLease(pool,{fileId,ownerId:id,token:loser})).rowCount!==0)
  throw Error('Non-owner discarded a pending upload');
 // Simulate a worker taking over after the first worker's lease expired.
 await pool.query("UPDATE v2_upload_completion_leases SET expires_at=now()-interval '1 second' WHERE file_id=$1",[fileId]);
 const successor=await acquireCompletionLease(pool,fileId,id);
 if(!successor||successor===winner)throw Error('Expired lease could not be replaced');
 if((await failPendingWithLease(pool,{fileId,ownerId:id,token:winner})).rowCount!==0)
  throw Error('Former owner marked the successor upload as failed');
 if((await discardPendingWithLease(pool,{fileId,ownerId:id,token:winner})).rowCount!==0)
  throw Error('Former owner discarded the successor upload');
 if((await promoteReadyWithLease(pool,{fileId,ownerId:id,finalKey:'ci/invalid',token:winner})).rowCount!==0)
  throw Error('Former owner bypassed READY promotion fence');
 if((await promoteReadyWithLease(pool,{fileId,ownerId:id,finalKey:'ci/verified',token:successor})).rowCount!==1)
  throw Error('Successor could not finish the pending upload');
 const promoted=await pool.query('SELECT status,object_key FROM library_files WHERE id=$1',[fileId]);
 if(promoted.rows[0]?.status!=='ready'||promoted.rows[0]?.object_key!=='ci/verified')
  throw Error('Upload did not preserve successor final object key');
 // Test legal failure and dedup deletion for separate pending rows.
 const insertPending=key=>pool.query(`INSERT INTO library_files(user_id,kind,object_key,original_name,content_type,byte_size,status)
  VALUES($1,'audio',$2,'ci.mp3','audio/mpeg',64,'pending') RETURNING id`,[id,key]);
 const rejectId=(await insertPending('ci/reject')).rows[0].id;
 const rejectToken=await acquireCompletionLease(pool,rejectId,id);
 if((await failPendingWithLease(pool,{fileId:rejectId,ownerId:id,token:rejectToken})).rowCount!==1)
  throw Error('Active owner could not fail its own invalid file');
 const discardId=(await insertPending('ci/discard')).rows[0].id;
 const discardToken=await acquireCompletionLease(pool,discardId,id);
 if((await discardPendingWithLease(pool,{fileId:discardId,ownerId:id,token:discardToken})).rowCount!==1)
  throw Error('Active owner could not discard its own duplicate');
 if((await pool.query('SELECT id FROM library_files WHERE id=$1',[discardId])).rowCount!==0)
  throw Error('Discarded upload still exists');
 await pool.query(`INSERT INTO v2_api_rate_limits(scope,subject_hash,window_started_at,hits)
  VALUES('s2-old',repeat('a',64),now()-interval '8 days',1),
   ('s2-new',repeat('b',64),now(),1)`);
 if(await pruneExpiredRateLimits(pool,{batchSize:1})!==1)
  throw Error('Rate-limit cleanup did not remove old row');
 const remaining=await pool.query("SELECT scope FROM v2_api_rate_limits WHERE scope IN ('s2-old','s2-new')");
 if(remaining.rows.length!==1||remaining.rows[0].scope!=='s2-new')
  throw Error('Rate-limit cleanup removed an active row or kept stale one');

 // PR #28: Trash metadata purge and media retirement on disposable DB only.
 const uid=id,sharedOwner=id;
 const beatOne='10000000-0000-4000-8000-000000000001';
 const beatTwo='10000000-0000-4000-8000-000000000002';
 const packId='10000000-0000-4000-8000-000000000003';
 const makeFile=async(objectKey,kind)=>{
  const q=await pool.query("INSERT INTO library_files(user_id,kind,object_key,original_name,content_type,byte_size,status) VALUES($1,$2,$3,'ci.mp3',$4,100,'ready') RETURNING id",[uid,kind,objectKey,kind==='cover'?'image/png':'audio/mpeg']);
  return q.rows[0].id;
 };
 const sharedCover=await makeFile('users/'+uid+'/assets/cover/verified/10000000-0000-4000-8000-000000000010.png','cover');
 const audioOne=await makeFile('users/'+uid+'/assets/audio/verified/10000000-0000-4000-8000-000000000011.mp3','audio');
 const audioTwo=await makeFile('users/'+uid+'/assets/audio/verified/10000000-0000-4000-8000-000000000012.mp3','audio');
 await pool.query('INSERT INTO library_beats(id,user_id,title,audio_file_id,cover_file_id) VALUES($1,$2,\'first\',$3,$4),($5,$2,\'second\',$6,$4)',[beatOne,uid,audioOne,sharedCover,beatTwo,audioTwo]);
 await pool.query("INSERT INTO library_packs(id,user_id,title) VALUES($1,$2,'pack')",[packId,uid]);
 await pool.query('INSERT INTO library_pack_beats(pack_id,beat_id,position) VALUES($1,$2,0),($1,$3,1)',[packId,beatOne,beatTwo]);
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN');
  const moved=await conn.query('UPDATE library_beats SET deleted_at=now() WHERE id=$1 AND user_id=$2 RETURNING id',[beatOne,uid]);
  if(moved.rowCount!==1)throw Error('Trash move failed');
  await conn.query('COMMIT');
 }catch(e){await conn.query('ROLLBACK');throw e}finally{conn.release()}
 let trashed=await pool.query('SELECT deleted_at FROM library_beats WHERE id=$1',[beatOne]);
 if(!trashed.rows[0]?.deleted_at)throw Error('Trash tombstone absent');
 // Test valid restore, followed by second move and permanent purge.
 await pool.query('UPDATE library_beats SET deleted_at=NULL WHERE id=$1 AND user_id=$2',[beatOne,uid]);
 if((await pool.query('SELECT deleted_at FROM library_beats WHERE id=$1',[beatOne])).rows[0].deleted_at)
  throw Error('Trash restore failed');
 const c=await pool.connect();
 let purged;
 try{
  await c.query('BEGIN');
  await c.query('UPDATE library_beats SET deleted_at=now() WHERE id=$1 AND user_id=$2',[beatOne,uid]);
  purged=await purgeTrashMetadata(c,uid);
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 if(purged.removedProjects!==1||purged.queuedMedia!==1)
  throw Error('Unexpected Trash purge result: '+JSON.stringify(purged));
 const survivor=await pool.query('SELECT id FROM library_beats WHERE id=$1',[beatTwo]);
 if(survivor.rowCount!==1)throw Error('Trash purged a live beat');
 const liveMedia=await pool.query('SELECT id FROM library_files WHERE id=ANY($1::bigint[])',[[sharedCover,audioTwo]]);
 if(liveMedia.rowCount!==2)throw Error('Trash deleted shared or live asset');
 const deadMedia=await pool.query('SELECT id FROM library_files WHERE id=$1',[audioOne]);
 if(deadMedia.rowCount!==0)throw Error('Unreferenced retired asset still exists in metadata');
 const jobs=await pool.query('SELECT object_key,completed_at FROM v2_r2_delete_jobs WHERE user_id=$1',[uid]);
 if(jobs.rowCount!==1||jobs.rows[0].completed_at!==null||
  jobs.rows[0].object_key!=='users/'+uid+'/assets/audio/verified/10000000-0000-4000-8000-000000000011.mp3')
  throw Error('Durable R2 delete job mismatch');
 const packMembers=await pool.query('SELECT beat_id FROM library_pack_beats WHERE pack_id=$1',[packId]);
 if(packMembers.rowCount!==1||String(packMembers.rows[0].beat_id)!==beatTwo)
  throw Error('Trash damaged remaining pack member');

 // Pack-only tracks must be trashed *with* their pack; a standalone track
 // and a track in another live pack must survive. Restoration must not revive
 // a track the owner manually deleted before deleting the pack.
 const cascadePack='10000000-0000-4000-8000-000000000030';
 const otherPack='10000000-0000-4000-8000-000000000031';
 const onlyBeat='10000000-0000-4000-8000-000000000032';
 const sharedBeat='10000000-0000-4000-8000-000000000033';
 const manualBeat='10000000-0000-4000-8000-000000000034';
 const ownFile=await makeFile('users/'+uid+'/assets/audio/verified/10000000-0000-4000-8000-000000000050.mp3','audio');
 const multiFile=await makeFile('users/'+uid+'/assets/audio/verified/10000000-0000-4000-8000-000000000051.mp3','audio');
 const manuallyDeletedFile=await makeFile('users/'+uid+'/assets/audio/verified/10000000-0000-4000-8000-000000000052.mp3','audio');
 await pool.query("INSERT INTO library_beats(id,user_id,title,audio_file_id,cover_file_id,library_visible) VALUES($1,$4,'pack only',$5,$8,FALSE),($2,$4,'other pack too',$6,$8,FALSE),($3,$4,'manually deleted',$7,$8,FALSE)",
  [onlyBeat,sharedBeat,manualBeat,uid,ownFile,multiFile,manuallyDeletedFile,sharedCover]);
 await pool.query("INSERT INTO library_packs(id,user_id,title,cover_file_id) VALUES($1,$3,'cascade pack',$4),($2,$3,'another pack',$4)",[cascadePack,otherPack,uid,sharedCover]);
 await pool.query('INSERT INTO library_pack_beats(pack_id,beat_id,position) VALUES($1,$3,0),($1,$4,1),($1,$5,2),($1,$6,3),($2,$4,0)',[cascadePack,otherPack,onlyBeat,sharedBeat,manualBeat,beatTwo]);
 await pool.query("UPDATE library_beats SET deleted_at=now()-interval '1 day' WHERE id=$1",[manualBeat]);
 const moveCascade=async()=>{
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const ok=await moveProjectToTrash(client,{owner:uid,kind:'pack',id:cascadePack});
   if(!ok)throw Error('Pack move to Trash failed');
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 };
 await pool.query("INSERT INTO v2_public_projects(user_id,kind,project_id) VALUES($1,'beat',$2),($1,'pack',$3)",[uid,onlyBeat,cascadePack]);
 await moveCascade();
 const tombstones=await pool.query("SELECT id,deleted_at FROM library_beats WHERE id=ANY($1::uuid[])",[[onlyBeat,sharedBeat,manualBeat,beatTwo]]);
 const byId=new Map(tombstones.rows.map(x=>[x.id,x.deleted_at]));
 const deletedPack=await pool.query('SELECT deleted_at FROM library_packs WHERE id=$1',[cascadePack]);
 if(!byId.get(onlyBeat)||String(byId.get(onlyBeat))!==String(deletedPack.rows[0].deleted_at))
  throw Error('Pack-only track did not cascade with pack timestamp');
 if(byId.get(sharedBeat)!==null||byId.get(beatTwo)!==null)
  throw Error('Pack deletion damaged live shared or standalone tracks');
 if(!byId.get(manualBeat)||String(byId.get(manualBeat))===String(deletedPack.rows[0].deleted_at))
  throw Error('Manually trashed member was overwritten by pack delete');
 const revoked=await pool.query('SELECT 1 FROM v2_public_projects WHERE user_id=$1 AND project_id=ANY($2::uuid[])',[uid,[onlyBeat,cascadePack]]);
 if(revoked.rowCount)throw Error('Pack deletion kept published edges');
 const listed=await pool.query(`SELECT b.id FROM library_beats b WHERE b.user_id=$1 AND b.deleted_at IS NOT NULL
  AND NOT (b.library_visible=FALSE AND EXISTS(
   SELECT 1 FROM library_pack_beats pb JOIN library_packs p ON p.id=pb.pack_id AND p.user_id=b.user_id
   WHERE pb.beat_id=b.id AND p.deleted_at=b.deleted_at))`,[uid]);
 if(listed.rows.some(x=>x.id===onlyBeat)||!listed.rows.some(x=>x.id===manualBeat))
  throw Error('Auto-deleted pack member leaked as duplicate Trash item');
 const req=Readable.from([]);
 req.method='POST';
 const response={status:0,body:null,writeHead(status){this.status=status;},end(raw){this.body=JSON.parse(raw);}};
 const handled=await handleTrash(req,response,'/api/library/trash/pack/'+cascadePack+'/restore',pool,async()=>({id:uid}),{storageFactory:()=>{throw Error('Restore must not touch R2')}});
 if(!handled||response.status!==200)throw Error('Pack restore API failed '+JSON.stringify(response));
 const restored=await pool.query('SELECT id,deleted_at FROM library_beats WHERE id=ANY($1::uuid[])',[[onlyBeat,sharedBeat,manualBeat]]);
 const restoredMap=new Map(restored.rows.map(x=>[x.id,x.deleted_at]));
 if(restoredMap.get(onlyBeat)!==null||restoredMap.get(sharedBeat)!==null||!restoredMap.get(manualBeat))
  throw Error('Pack restore lost exclusive track or revived manually deleted member');
 const parentRestored=await pool.query('SELECT deleted_at FROM library_packs WHERE id=$1',[cascadePack]);
 if(parentRestored.rows[0].deleted_at!==null)throw Error('Parent pack not restored');
 await moveCascade();
 const c2=await pool.connect();
 let cascadePurge;
 try{
  await c2.query('BEGIN');
  cascadePurge=await purgeTrashMetadata(c2,uid);
  await c2.query('COMMIT');
 }catch(e){await c2.query('ROLLBACK');throw e;}finally{c2.release();}
 if(cascadePurge.removedProjects!==3)throw Error('Pack purge did not retire its two exclusive members and pack: '+JSON.stringify(cascadePurge));
 const protectedProjects=await pool.query('SELECT id FROM library_beats WHERE id=ANY($1::uuid[])',[[sharedBeat,beatTwo]]);
 if(protectedProjects.rowCount!==2||!(await pool.query('SELECT id FROM library_packs WHERE id=$1',[otherPack])).rowCount)
  throw Error('Pack purge damaged other active pack or shared beat');
 const retiredFiles=await pool.query('SELECT id FROM library_files WHERE id=ANY($1::bigint[])',[[ownFile,manuallyDeletedFile,multiFile]]);
 if(retiredFiles.rowCount!==1||String(retiredFiles.rows[0].id)!==String(multiFile))
  throw Error('Pack-only audio retirement damaged live shared file or retained unreferenced files');
 const newJobs=await pool.query('SELECT object_key FROM v2_r2_delete_jobs WHERE user_id=$1 AND object_key LIKE $2',[uid,'users/'+uid+'/assets/audio/verified/%']);
 if(!newJobs.rows.some(x=>x.object_key.endsWith('000000000050.mp3'))||
    !newJobs.rows.some(x=>x.object_key.endsWith('000000000052.mp3'))||
     newJobs.rows.some(x=>x.object_key.endsWith('000000000051.mp3')))
  throw Error('Pack cascade R2 outbox did not protect live shared audio');
 console.log('S2 isolated PostgreSQL migration: PASS (010+011+012, owner leases, Trash safe metadata purge and R2 outbox)');

}finally{
 await pool.end();
}
