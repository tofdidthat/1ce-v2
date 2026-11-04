// 1CE v2 only: soft Trash and user-confirmed permanent purge.
// Object deletion is driven by a transactional DB outbox, never a client key.
import {randomUUID} from 'node:crypto';
import {S3Client,DeleteObjectCommand} from '@aws-sdk/client-s3';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {ProjectKindV2,QueryableV2} from '../../../packages/shared/contracts.js';

type TxClientV2=QueryableV2&{release():void};
type TxPoolV2=QueryableV2&{connect():Promise<TxClientV2>};
type AccountV2={id:number|string};
type CurrentUserV2=(req:IncomingMessage)=>Promise<AccountV2|null>;
type StorageV2={bucket:string;s3:S3Client};


const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeKey=/^users\/[1-9]\d*\/assets\/(audio|cover|stems)\/verified\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mp3|wav|jpg|jpeg|png|webp|zip)$/i;
const tableFor=(kind:unknown):string|null=>kind==='beat'?'library_beats':kind==='pack'?'library_packs':null;
const respond=(res:ServerResponse,status:number,payload:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload));};

async function tx<T>(pool:TxPoolV2,fn:(db:TxClientV2)=>Promise<T>):Promise<T>{
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const result=await fn(db);
  await db.query('COMMIT');
  return result;
 }catch(err){try{await db.query('ROLLBACK');}catch{}throw err;}
 finally{db.release();}
}
async function json(req:IncomingMessage):Promise<{confirmation?:unknown}|null>{
 let raw='';
 for await(const chunk of req){raw+=chunk;if(raw.length>1024)throw Error('Invalid confirmation');}
 try{return JSON.parse(raw) as {confirmation?:unknown}|null}catch{throw Error('Invalid confirmation')}
}
function storage():StorageV2|null{
 const {R2_ACCOUNT_ID:account,R2_ACCESS_KEY_ID:key,R2_SECRET_ACCESS_KEY:secret,R2_BUCKET_NAME:bucket}=process.env;
 if(!account||!key||!secret||!bucket)return null;
 return {bucket,s3:new S3Client({region:'auto',endpoint:'https://'+account+'.r2.cloudflarestorage.com',credentials:{accessKeyId:key,secretAccessKey:secret},forcePathStyle:true})};
}

// Must be called inside the existing project-actions transaction.
export async function moveProjectToTrash(db:QueryableV2,{owner,kind,id}:{owner:number;kind:ProjectKindV2;id:string}):Promise<boolean>{
 const table=tableFor(kind);
 if(!table||!uuid.test(id))return false;
 await db.query('SELECT pg_advisory_xact_lock($1::bigint)',[owner]);
 const moved=await db.query('UPDATE '+table+' SET deleted_at=now() WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id',[owner,id]);
 if(!moved.rowCount)return false;
 // Pack-only beats have no standalone Home listing and must move with their
 // last active pack. Keep standalone beats and beats used by any other live pack.
 // Use the pack's exact deletion timestamp as the cascade marker so restore
 // can tell these apart from beats the owner deleted manually earlier.
 let cascadeIds:string[]=[];
 if(kind==='pack'){
  const cascaded=await db.query(`UPDATE library_beats b SET deleted_at=p.deleted_at
   FROM library_packs p JOIN library_pack_beats pb ON pb.pack_id=p.id
   WHERE p.id=$2 AND p.user_id=$1 AND pb.beat_id=b.id AND b.user_id=$1
     AND b.deleted_at IS NULL AND b.library_visible=FALSE
     AND NOT EXISTS(
      SELECT 1 FROM library_pack_beats shared
      JOIN library_packs other ON other.id=shared.pack_id
      WHERE shared.beat_id=b.id AND other.user_id=$1 AND other.deleted_at IS NULL
     )
   RETURNING b.id`,[owner,id]);
  cascadeIds=cascaded.rows.map(row=>row.id as string);
 }
 // Revoke every public, saved and shared edge for the pack AND its
 // automatically trashed members, atomically with the tombstones.
 for(const [edgeTable,column] of [
  ['v2_public_projects','user_id'],['v2_public_saves','owner_id'],
  ['v2_project_access','owner_id'],['v2_project_share_links','owner_id']
 ]){
  await db.query('DELETE FROM '+edgeTable+' WHERE '+column+'=$1 AND kind=$2 AND project_id=$3',[owner,kind,id]);
  if(cascadeIds.length)await db.query('DELETE FROM '+edgeTable+" WHERE "+column+"=$1 AND kind='beat' AND project_id=ANY($2::uuid[])",[owner,cascadeIds]);
 }
 return true;
}

export async function purgeTrashMetadata(db:QueryableV2,owner:number):Promise<{removedProjects:number;queuedMedia:number}>{
 // Serialize purges for this account. Concurrent project INSERTs are also
 // protected by the FK references to library_files at the final DELETE.
 await db.query('SELECT pg_advisory_xact_lock($1::bigint)',[owner]);
 const refs=await db.query("SELECT DISTINCT asset_id FROM (SELECT audio_file_id AS asset_id FROM library_beats WHERE user_id=$1 AND deleted_at IS NOT NULL UNION ALL SELECT cover_file_id FROM library_beats WHERE user_id=$1 AND deleted_at IS NOT NULL UNION ALL SELECT stems_file_id FROM library_beats WHERE user_id=$1 AND deleted_at IS NOT NULL UNION ALL SELECT cover_file_id FROM library_packs WHERE user_id=$1 AND deleted_at IS NOT NULL) candidate WHERE asset_id IS NOT NULL",[owner]);
 const assetIds=refs.rows.map(row=>row.asset_id);
 // Pack members are not owned copies. Other beats in each pack are preserved.
 await db.query('DELETE FROM library_pack_beats WHERE beat_id IN (SELECT id FROM library_beats WHERE user_id=$1 AND deleted_at IS NOT NULL)',[owner]);
 const beats=await db.query('DELETE FROM library_beats WHERE user_id=$1 AND deleted_at IS NOT NULL RETURNING id',[owner]);
 const packs=await db.query('DELETE FROM library_packs WHERE user_id=$1 AND deleted_at IS NOT NULL RETURNING id',[owner]);
 let queuedMedia=0;
 if(assetIds.length){
  // FK ON DELETE RESTRICT prevents a concurrent beat/pack from acquiring a
  // reference while retiring media. The queue and DB retirement commit as one.
  const q=await db.query("WITH retired AS (DELETE FROM library_files f WHERE f.user_id=$1 AND f.id=ANY($2::bigint[]) AND f.status='ready' AND f.object_key ~ ('^users/' || $1::text || '/assets/(audio|cover|stems)/verified/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](mp3|wav|jpg|jpeg|png|webp|zip)$') AND NOT EXISTS (SELECT 1 FROM library_beats b WHERE b.audio_file_id=f.id OR b.cover_file_id=f.id OR b.stems_file_id=f.id) AND NOT EXISTS (SELECT 1 FROM library_packs p WHERE p.cover_file_id=f.id) RETURNING f.user_id,f.object_key), queued AS (INSERT INTO v2_r2_delete_jobs(user_id,object_key) SELECT user_id,object_key FROM retired ON CONFLICT (object_key) DO NOTHING RETURNING id) SELECT count(*)::int AS total FROM queued",[owner,assetIds]);
  queuedMedia=Number(q.rows[0]?.total||0);
 }
 return {removedProjects:(beats.rowCount??0)+(packs.rowCount??0),queuedMedia};
}

export async function processPendingTrashJobs(pool:QueryableV2,{owner,s3,bucket,max=12}:{owner:number;s3:S3Client;bucket:string;max?:number}):Promise<{deletedMedia:number;failedMedia:number;pendingMedia:number}>{
 if(!s3||!bucket)throw Error('Storage unavailable');
 let deletedMedia=0,failedMedia=0;
 for(let n=0;n<max;n++){
  const token=randomUUID();
  const claim=await pool.query("WITH next AS (SELECT id FROM v2_r2_delete_jobs WHERE user_id=$1 AND completed_at IS NULL AND (claim_until IS NULL OR claim_until<now()) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) UPDATE v2_r2_delete_jobs j SET claim_token=$2::uuid,claim_until=now()+interval '2 minutes',attempts=j.attempts+1 FROM next WHERE j.id=next.id RETURNING j.id,j.object_key",[owner,token]);
  const job=claim.rows[0] as {id:number|string;object_key:string}|undefined;
  if(!job)break;
  if(!safeKey.test(job.object_key)||!job.object_key.startsWith('users/'+owner+'/')){
   await pool.query("UPDATE v2_r2_delete_jobs SET claim_token=NULL,claim_until=NULL,last_error='Unsafe key refused' WHERE id=$1 AND user_id=$2 AND claim_token=$3::uuid",[job.id,owner,token]);
   failedMedia++;
   break;
  }
  try{
   await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:job.object_key}),{abortSignal:AbortSignal.timeout(15000)});
   await pool.query("UPDATE v2_r2_delete_jobs SET completed_at=now(),claim_token=NULL,claim_until=NULL,last_error=NULL WHERE id=$1 AND user_id=$2 AND claim_token=$3::uuid",[job.id,owner,token]);
   deletedMedia++;
  }catch(err){
   await pool.query("UPDATE v2_r2_delete_jobs SET claim_token=NULL,claim_until=NULL,last_error='R2 delete failed; retry later' WHERE id=$1 AND user_id=$2 AND claim_token=$3::uuid",[job.id,owner,token]);
   failedMedia++;
   break;
  }
 }
 const pending=await pool.query('SELECT count(*)::int AS pending FROM v2_r2_delete_jobs WHERE user_id=$1 AND completed_at IS NULL',[owner]);
 return {deletedMedia,failedMedia,pendingMedia:Number(pending.rows[0]?.pending||0)};
}

export async function handleTrash(req:IncomingMessage,res:ServerResponse,pathname:string,pool:TxPoolV2,currentUser:CurrentUserV2,{storageFactory=storage}:{storageFactory?:()=>StorageV2|null}={}):Promise<boolean>{
 if(!pathname.startsWith('/api/library/trash'))return false;
 if(!['GET','POST'].includes(req.method||'')){respond(res,405,{error:'Method not allowed'});return true;}
 const user=await currentUser(req);
 if(!user){respond(res,401,{error:'Not authenticated'});return true;}
 const owner=Number(user.id),parts=pathname.split('/').filter(Boolean);
 if(!Number.isSafeInteger(owner)||owner<1){respond(res,401,{error:'Not authenticated'});return true;}
 if(req.method==='GET'&&parts.length===3){
  const [beats,packs,pending]=await Promise.all([
   pool.query(`SELECT b.id,b.title,b.deleted_at FROM library_beats b
    WHERE b.user_id=$1 AND b.deleted_at IS NOT NULL
      AND NOT (b.library_visible=FALSE AND EXISTS(
       SELECT 1 FROM library_pack_beats pb
       JOIN library_packs p ON p.id=pb.pack_id AND p.user_id=b.user_id
       WHERE pb.beat_id=b.id AND p.deleted_at=b.deleted_at
      ))
    ORDER BY b.deleted_at DESC LIMIT 200`,[owner]),
   pool.query('SELECT id,title,deleted_at FROM library_packs WHERE user_id=$1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100',[owner]),
   pool.query('SELECT count(*)::int AS pending FROM v2_r2_delete_jobs WHERE user_id=$1 AND completed_at IS NULL',[owner])
  ]);
  const items=[...beats.rows.map(x=>({...x,kind:'beat'})),...packs.rows.map(x=>({...x,kind:'pack'}))]
   .sort((a,b)=>new Date(b.deleted_at as string|Date).getTime()-new Date(a.deleted_at as string|Date).getTime());
  respond(res,200,{items,pendingMedia:Number(pending.rows[0]?.pending||0),retentionDays:30});return true;
 }
 if(req.method==='POST'&&parts.length===6&&tableFor(parts[3])&&uuid.test(parts[4])&&parts[5]==='restore'){
  const kind=parts[3] as ProjectKindV2,id=parts[4];
  const found=await tx(pool,async db=>{
   await db.query('SELECT pg_advisory_xact_lock($1::bigint)',[owner]);
   if(kind==='pack'){
    // First verify that the parent is eligible. The cascade-marker comparison
    // must happen before the parent tombstone is cleared.
    const parent=await db.query("SELECT id FROM library_packs WHERE user_id=$1 AND id=$2 AND deleted_at>=now()-interval '30 days' FOR UPDATE",[owner,id]);
    if(!parent.rowCount)return false;
    // Restoring any pack revives only hidden beats automatically trashed when
    // their last live pack was deleted, never individually deleted beats.
    // This also handles a beat originally shared by two now-trashed packs.
    await db.query(`UPDATE library_beats b SET deleted_at=NULL
     WHERE b.user_id=$1 AND b.deleted_at IS NOT NULL AND b.library_visible=FALSE
       AND EXISTS(SELECT 1 FROM library_pack_beats pb WHERE pb.pack_id=$2 AND pb.beat_id=b.id)
       AND EXISTS(
        SELECT 1 FROM library_pack_beats source_pb
        JOIN library_packs source_p ON source_p.id=source_pb.pack_id AND source_p.user_id=$1
        WHERE source_pb.beat_id=b.id AND source_p.deleted_at=b.deleted_at
       )`,[owner,id]);
   }
   const q=await db.query('UPDATE '+tableFor(kind)+" SET deleted_at=NULL WHERE user_id=$1 AND id=$2 AND deleted_at>=now()-interval '30 days' RETURNING id",[owner,id]);
   return (q.rowCount??0)>0;
  });
  respond(res,found?200:404,found?{restored:true,id,kind}:{error:'Project not found or recovery period ended'});return true;
 }
 if(req.method==='POST'&&parts.length===4&&parts[3]==='empty'){
  let data;
  try{data=await json(req)}catch{respond(res,400,{error:'Invalid confirmation'});return true;}
  if(data?.confirmation!=='EMPTY TRASH'){respond(res,400,{error:'Type EMPTY TRASH to delete permanently'});return true;}
  const r2=storageFactory();
  if(!r2){respond(res,503,{error:'Storage unavailable. Trash was not emptied.'});return true;}
  try{
   const result=await tx(pool,db=>purgeTrashMetadata(db,owner));
   const processed=await processPendingTrashJobs(pool,{owner,s3:r2.s3,bucket:r2.bucket});
   respond(res,processed.pendingMedia?202:200,{...result,...processed,done:processed.pendingMedia===0});return true;
  }finally{r2.s3.destroy?.();}
 }
 respond(res,404,{error:'Not found'});return true;
}
