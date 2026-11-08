// Private Cloudflare R2 uploads for 1CE v2 only. No v1 resources.
import { randomUUID, createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import {verifyUploadedObject,InvalidMedia,VerificationUnavailable} from './upload-security.js';
import {rateLimitExceeded,uploadLimits} from './api-rate-limits.js';
import {accountStorageQuota} from './storage-plans.js';
import {acquireCompletionLease,releaseCompletionLease,promoteReadyWithLease,failPendingWithLease,discardPendingWithLease} from './upload-leases.js';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {handlePrivateLibraryMetadataRead} from './library-read-metadata.js';
import {handlePrivateLibraryStream} from './library-streaming.js';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {QueryableV2,DbQueryResultV2,MediaKindV2} from '../../../packages/shared/contracts.js';

type AccountV2={id:number};
type CurrentUserV2=(req:IncomingMessage)=>Promise<AccountV2|null>;
type TransactionClientV2=QueryableV2&{release():void};
type TransactionPoolV2=QueryableV2&{connect():Promise<TransactionClientV2>};
type StorageV2={s3:S3Client|null;bucket:string};
type DependencyOverridesV2={
 storageFactory?:()=>StorageV2;
 signUrl?:typeof getSignedUrl;
};
type StoredPendingFileV2={
 id:number|string;
 kind:MediaKindV2;
 sha256:string;
 object_key:string;
 content_type:string;
 byte_size:number|string;
 status:string;
};
const isMediaKindV2=(value:unknown):value is MediaKindV2=>
 value==='audio'||value==='cover'||value==='stems';
const validStoredFileId=(value:unknown):value is number|string=>
 (typeof value==='number'&&Number.isSafeInteger(value)&&value>0)||
 (typeof value==='string'&&/^[1-9][0-9]*$/.test(value)&&Number.isSafeInteger(Number(value)));
const validStoredBytes=(value:unknown):value is number|string=>
 (typeof value==='number'&&Number.isSafeInteger(value)&&value>0)||
 (typeof value==='string'&&/^[1-9][0-9]*$/.test(value));
function decodePendingUploadRow(value:unknown,ownerId:number):StoredPendingFileV2{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid pending upload metadata');
 const row=value as Record<string,unknown>;
 if(!validStoredFileId(row.id)||!isMediaKindV2(row.kind)||
  typeof row.sha256!=='string'||!/^[0-9a-f]{64}$/i.test(row.sha256)||
  typeof row.object_key!=='string'||!row.object_key.startsWith('staging/users/'+ownerId+'/assets/'+row.kind+'/')||
  typeof row.content_type!=='string'||!row.content_type||!validStoredBytes(row.byte_size)||row.status!=='pending')
  throw Error('Invalid pending upload metadata');
 return {id:row.id,kind:row.kind,sha256:row.sha256,object_key:row.object_key,
  content_type:row.content_type,byte_size:row.byte_size,status:'pending'};
}

const limits:Record<MediaKindV2,number>={audio:150*1024*1024,cover:15*1024*1024,stems:250*1024*1024};
const types:Record<MediaKindV2,Record<string,readonly string[]>>={
 audio:{'audio/mpeg':['mp3'],'audio/mp3':['mp3'],'audio/wav':['wav'],'audio/x-wav':['wav'],'audio/wave':['wav']},
 cover:{'image/jpeg':['jpg','jpeg'],'image/png':['png'],'image/webp':['webp']},
 stems:{'application/zip':['zip'],'application/x-zip-compressed':['zip']}
};
const config=()=>({
 account:process.env.R2_ACCOUNT_ID,
 key:process.env.R2_ACCESS_KEY_ID,
 secret:process.env.R2_SECRET_ACCESS_KEY,
 bucket:process.env.R2_BUCKET_NAME
});
function client():S3Client|null{
 const c=config();
 if(!c.account||!c.key||!c.secret||!c.bucket) return null;
 return new S3Client({region:'auto',endpoint:'https://'+c.account+'.r2.cloudflarestorage.com',
 credentials:{accessKeyId:c.key,secretAccessKey:c.secret},forcePathStyle:true});
}
const send=(res:ServerResponse,status:number,data:unknown):void=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function bodyJSON(req:IncomingMessage):Promise<Record<string,unknown>|null>{
 let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8192)throw new Error('Request too large');}
 try{
  const value:unknown=JSON.parse(raw);
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
 }catch{throw new Error('Invalid JSON');}
}
// Optional dependencies are for request-level regression tests; in production
// the exact same private R2 client and presigner are used as before.
export async function handleLibraryFiles(
 req:IncomingMessage,res:ServerResponse,pathname:string,
 pool:TransactionPoolV2,currentUser:CurrentUserV2,{
  storageFactory=()=>({s3:client(),bucket:config().bucket as string}),
  signUrl=getSignedUrl
 }:DependencyOverridesV2={}
):Promise<boolean>{
 if(!pathname.startsWith('/api/library/files'))return false;
 if(!['GET','POST'].includes(req.method||'')){send(res,405,{error:'Method not allowed'});return true;}
 const user=await currentUser(req);
 if(!user){send(res,401,{error:'Not authenticated'});return true;}
 const {s3,bucket}=storageFactory(),cfg={bucket};
 if(!s3){send(res,503,{error:'Storage is not configured'});return true;}
 const segments=pathname.split('/').filter(Boolean);
 if(req.method==='POST'&&segments.length===4&&segments[3]==='beats'){
  let data:Record<string,unknown>|null;try{data=await bodyJSON(req)}catch{send(res,400,{error:'Invalid request'});return true;}
  const title=typeof data?.title==='string'?data.title.trim():'';
  if(!title||title.length>180||typeof data?.audioFileId!=='number'||!Number.isSafeInteger(data.audioFileId)||data.audioFileId<1){send(res,400,{error:'Invalid beat'});return true;}
  const ids=[data.audioFileId,data.coverFileId,data.stemsFileId].filter(x=>x!=null);
  if(ids.some(x=>typeof x!=='number'||!Number.isSafeInteger(x)||x<1)){send(res,400,{error:'Invalid asset IDs'});return true;}
  // Take the same owner lock as Trash: a concurrent purge cannot retire a
  // verified media row between the READY check and linking a new beat.
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   await db.query('SELECT pg_advisory_xact_lock($1::bigint)',[user.id]);
   const q=await db.query("SELECT id,kind FROM library_files WHERE user_id=$1 AND status='ready' AND id=ANY($2::bigint[])",[user.id,ids]);
   const valid=new Map(q.rows.map(x=>[Number(x.id),x.kind]));
   if(valid.get(data.audioFileId)!=='audio'||data.coverFileId!=null&&valid.get(data.coverFileId as number)!=='cover'||data.stemsFileId!=null&&valid.get(data.stemsFileId as number)!=='stems'){
    await db.query('ROLLBACK');send(res,400,{error:'Assets must be owned by you and ready'});return true;
   }
   const existing=await db.query("SELECT id,deleted_at FROM library_beats WHERE user_id=$1 AND audio_file_id=$2",[user.id,data.audioFileId]);
   if(existing.rows[0]){
    await db.query('COMMIT');
    if(existing.rows[0].deleted_at){send(res,409,{error:'Beat is in Trash. Restore it first.'});return true;}
    send(res,200,{id:existing.rows[0].id,reused:true});return true;
   }
   const id=randomUUID();
   await db.query("INSERT INTO library_beats(id,user_id,title,audio_file_id,cover_file_id,stems_file_id) VALUES($1,$2,$3,$4,$5,$6)",[id,user.id,title,data.audioFileId,data.coverFileId||null,data.stemsFileId||null]);
   await db.query('COMMIT');send(res,201,{id});return true;
  }catch(err){try{await db.query('ROLLBACK');}catch{}throw err;}
  finally{db.release();}
 }
 if(req.method==='POST'&&segments.length===4&&segments[3]==='packs'){
  let data:Record<string,unknown>|null;try{data=await bodyJSON(req)}catch{send(res,400,{error:'Invalid request'});return true;}
  const title=typeof data?.title==='string'?data.title.trim():'';
  const beatIds=data?.beatIds;
  const newBeatIds=data?.newBeatIds||[];
  if(!title||title.length>180||!Array.isArray(beatIds)||beatIds.length<2||beatIds.length>100||new Set(beatIds).size!==beatIds.length||beatIds.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))){send(res,400,{error:'Invalid pack'});return true;}
  if(!Array.isArray(newBeatIds)||new Set(newBeatIds).size!==newBeatIds.length||newBeatIds.some(id=>!beatIds.includes(id))){send(res,400,{error:'Invalid new beat IDs'});return true;}
  if(data?.coverFileId!=null&&(typeof data.coverFileId!=='number'||!Number.isSafeInteger(data.coverFileId)||data.coverFileId<1)){send(res,400,{error:'Invalid cover'});return true;}
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[user.id]);
   const owned=await client.query('SELECT id FROM library_beats WHERE user_id=$1 AND deleted_at IS NULL AND id=ANY($2::uuid[])',[user.id,beatIds]);
   if(owned.rowCount!==beatIds.length){await client.query('ROLLBACK');send(res,403,{error:'Beat not owned by you'});return true;}
   if(data?.coverFileId!=null){
    const cover=await client.query("SELECT id FROM library_files WHERE id=$1 AND user_id=$2 AND kind='cover' AND status='ready'",[data?.coverFileId,user.id]);
    if(!cover.rowCount){await client.query('ROLLBACK');send(res,403,{error:'Cover not owned by you'});return true;}
   }
   const id=randomUUID();
   await client.query('INSERT INTO library_packs(id,user_id,title,cover_file_id) VALUES($1,$2,$3,$4)',[id,user.id,title,data?.coverFileId||null]);
   for(let i=0;i<beatIds.length;i++)await client.query('INSERT INTO library_pack_beats(pack_id,beat_id,position) VALUES($1,$2,$3)',[id,beatIds[i],i]);
   if(newBeatIds.length)await client.query('UPDATE library_beats SET library_visible=FALSE WHERE user_id=$1 AND id=ANY($2::uuid[]) AND library_visible=TRUE',[user.id,newBeatIds]);
   await client.query('COMMIT');send(res,201,{id});return true;
  }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
 }
 // Streaming byte reads move as one unit; method/session/storage checks remain above.
 if(req.method==='GET'&&await handlePrivateLibraryStream(req,res,segments,pool,user.id,s3,cfg.bucket,send))return true;
 // Only metadata reads move; method/session/storage checks remain above.
 if(req.method==='GET'&&await handlePrivateLibraryMetadataRead(res,segments,pool,user.id,send))return true;
 if(req.method==='POST'&&segments.length===4&&segments[3]==='init'){
  let data:Record<string,unknown>|null;try{data=await bodyJSON(req)}catch{send(res,400,{error:'Invalid request'});return true;}
  const {kind,name,contentType,size,sha256}=data||{};
  const ext=typeof name==='string'?name.toLowerCase().split('.').pop()||'':'';
  if(!isMediaKindV2(kind)||typeof name!=='string'||name.length>240||name.length<1||/[\\/\x00-\x1f]/.test(name)||
   typeof contentType!=='string'||!types[kind]?.[contentType]?.includes(ext)||
   typeof size!=='number'||!Number.isSafeInteger(size)||size<=0||size>limits[kind]||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)){
   send(res,400,{error:'Unsupported file type or size'});return true;
  }
  // Serialize per-owner reservations across replicas. Only pending keys
  // receive signed PUT URLs; verified keys are never writable by clients.
  if(await rateLimitExceeded(pool,'upload-init',user.id,uploadLimits.initPerHour,60)){
   send(res,429,{error:'Upload rate limit reached'});return true;
  }
  const db=await pool.connect();
  let inserted!:DbQueryResultV2,objectKey!:string;
  try{
   await db.query('BEGIN');
   await db.query('SELECT pg_advisory_xact_lock($1::bigint)',[user.id]);
   const existing=await db.query("SELECT id FROM library_files WHERE user_id=$1 AND kind=$2 AND sha256=$3 AND status='ready' LIMIT 1",[user.id,kind,sha256]);
   if(existing.rows[0]){
    await db.query('COMMIT');send(res,200,{id:existing.rows[0].id,reused:true});return true;
   }
   const quota=await db.query(`SELECT
    count(*) FILTER (WHERE status='pending' AND created_at>now()-interval '30 minutes')::int AS pending_count,
    COALESCE(sum(byte_size) FILTER (WHERE status='ready' OR
      (status='pending' AND created_at>now()-interval '30 minutes')),0)::text AS reserved_bytes
    FROM library_files WHERE user_id=$1`,[user.id]);
   const maxStoredBytes=await accountStorageQuota(db,user.id);
   const count=Number(quota.rows[0]?.pending_count||0);
   const reserved=Number(quota.rows[0]?.reserved_bytes||0);
   if(count>=uploadLimits.maxPending||reserved+size>maxStoredBytes){
    await db.query('ROLLBACK');
    send(res,429,{error:'Account upload quota reached'});return true;
   }
   objectKey='staging/users/'+user.id+'/assets/'+kind+'/'+randomUUID()+'.'+ext;
   inserted=await db.query("INSERT INTO library_files(user_id,kind,object_key,original_name,content_type,byte_size,status,sha256) VALUES($1,$2,$3,$4,$5,$6,'pending',$7) RETURNING id",[user.id,kind,objectKey,name,contentType,size,sha256]);
   await db.query('COMMIT');
  }catch(err){try{await db.query('ROLLBACK');}catch{}throw err;}
  finally{db.release();}
  try{
   const uploadUrl=await signUrl(s3,new PutObjectCommand({Bucket:cfg.bucket,Key:objectKey,ContentType:contentType,ContentLength:size}),{expiresIn:300});
   send(res,200,{id:inserted.rows[0].id,uploadUrl,expiresIn:300});
  }catch(err){
   await pool.query("DELETE FROM library_files WHERE id=$1 AND user_id=$2 AND status='pending'",[inserted.rows[0].id,user.id]);
   throw err;
  }
  return true;
 }
 if(req.method==='POST'&&segments.length===5&&segments[4]==='complete'&&/^\d+$/.test(segments[3])){
  const id=segments[3];
  const q=await pool.query('SELECT id,kind,sha256,object_key,content_type,byte_size,status FROM library_files WHERE id=$1 AND user_id=$2',[id,user.id]);
  const rawFile=q.rows[0];
  if(!rawFile){send(res,404,{error:'File not found'});return true;}
  if(rawFile.status==='ready'){
   if(!validStoredFileId(rawFile.id))throw Error('Invalid ready upload metadata');
   send(res,200,{ok:true,id:rawFile.id});return true;
  }
  if(rawFile.status!=='pending'){send(res,409,{error:'Invalid upload state'});return true;}
  // Corrupt staging metadata must not acquire a completion lease or reach R2.
  const file=decodePendingUploadRow(rawFile,user.id);
  if(await rateLimitExceeded(pool,'upload-complete',user.id,uploadLimits.completePerHour,60)){
   send(res,429,{error:'Upload completion rate limit reached'});return true;
  }
  const pending=await pool.query("SELECT created_at>now()-interval '30 minutes' AS valid FROM library_files WHERE id=$1 AND user_id=$2 AND status='pending'",[id,user.id]);
  if(!pending.rows[0]?.valid){send(res,410,{error:'Upload expired; start a new upload'});return true;}
  const leaseToken=await acquireCompletionLease(pool,id,user.id);
  if(!leaseToken){
   // The first request still owns the finalization. Do not make redundant R2
   // HEAD, COPY or GET requests while it runs on another API replica.
   const current=await pool.query('SELECT status FROM library_files WHERE id=$1 AND user_id=$2',[id,user.id]);
   if(current.rows[0]?.status==='ready'){send(res,200,{ok:true,id:file.id});return true;}
   send(res,409,{error:'Upload finalization in progress; retry shortly'});return true;
  }
  try{
  const stagingKey=file.object_key;
  const extension=stagingKey.split('.').pop();
  const finalKey='users/'+user.id+'/assets/'+file.kind+'/verified/'+randomUUID()+'.'+extension;
  const deleteObject=async (key:string):Promise<void>=>{
   try{await s3.send(new DeleteObjectCommand({Bucket:cfg.bucket,Key:key}),{abortSignal:AbortSignal.timeout(15000)});}
   catch(err){console.error('R2 cleanup deferred',(err as {message?:string}|null)?.message);}
  };
  const lostLease=async()=>{
   const current=await pool.query('SELECT status FROM library_files WHERE id=$1 AND user_id=$2',[id,user.id]);
   if(current.rows[0]?.status==='ready')send(res,200,{ok:true,id:file.id});
   else send(res,409,{error:'Upload finalization ownership changed; retry shortly'});
   return true;
  };
  const rejectInvalid=async (error:string):Promise<boolean>=>{
   // A former owner may be resuming after its lease expired. Only the current
   // token may mark the row failed, and only then may staging be deleted.
   const failed=await failPendingWithLease(pool,{fileId:id,ownerId:user.id,token:leaseToken});
   if(!failed.rowCount)return lostLease();
   await deleteObject(stagingKey);
   send(res,422,{error});return true;
  };
  try{
   const head=await s3.send(new HeadObjectCommand({Bucket:cfg.bucket,Key:stagingKey}),{abortSignal:AbortSignal.timeout(15000)});
   if(Number(head.ContentLength)!==Number(file.byte_size)||head.ContentType!==file.content_type)
    return await rejectInvalid('Uploaded file metadata did not match');
   // Source-conditional copy must fail closed when HEAD lacks a usable ETag.
   if(typeof head.ETag!=='string'||!head.ETag.trim())
    throw new VerificationUnavailable('Storage ETag unavailable for conditional copy');
   // Source can change while a signed PUT remains live. Copy with server
   // credentials to a never-signed final key and verify FINAL bytes.
   await s3.send(new CopyObjectCommand({
    Bucket:cfg.bucket,Key:finalKey,CopySource:cfg.bucket+'/'+stagingKey,
    CopySourceIfMatch:head.ETag
   }),{abortSignal:AbortSignal.timeout(180000)});
   await verifyUploadedObject({s3,bucket:cfg.bucket,key:finalKey,file});
  }catch(err){
   const failure=err as {name?:string;$metadata?:{httpStatusCode?:number};code?:string}|null;
   await deleteObject(finalKey);
   if(err instanceof InvalidMedia)return await rejectInvalid(err.message);
   if(failure?.name==='NotFound'||failure?.$metadata?.httpStatusCode===404){
    send(res,409,{error:'Upload not found in storage'});return true;
   }
   if(failure?.$metadata?.httpStatusCode===412){
    send(res,409,{error:'Upload changed during verification; retry'});return true;
   }
   if(err instanceof VerificationUnavailable||failure?.name==='AbortError'){
    send(res,503,{error:'Storage verification unavailable; retry'});return true;
   }
   throw err;
  }
  try{
   const updated=await promoteReadyWithLease(pool,{
    fileId:id,ownerId:user.id,finalKey,token:leaseToken
   });
   if(!updated.rowCount){
    await deleteObject(finalKey);
    const current=await pool.query('SELECT id,status FROM library_files WHERE id=$1 AND user_id=$2',[id,user.id]);
    if(current.rows[0]?.status==='ready'){send(res,200,{ok:true,id:file.id});return true;}
    send(res,409,{error:'Upload state changed; retry'});return true;
   }
  }catch(err){
   if((err as {code?:string}|null)?.code==='23505'){
    const existing=await pool.query("SELECT id FROM library_files WHERE user_id=$1 AND kind=$2 AND sha256=$3 AND status='ready'",[user.id,file.kind,file.sha256]);
    if(existing.rows[0]){
     // The original lease may have expired while handling the 23505; never
     // delete a newer finalizer's pending DB row or its staging object.
     const discarded=await discardPendingWithLease(pool,{fileId:id,ownerId:user.id,token:leaseToken});
     await deleteObject(finalKey);
     if(!discarded.rowCount)return await lostLease();
     await deleteObject(stagingKey);
     send(res,200,{ok:true,id:existing.rows[0].id,reused:true});return true;
    }
   }
   // A committed DB write with a lost response must retain its final object.
   const current=await pool.query('SELECT object_key,status FROM library_files WHERE id=$1 AND user_id=$2',[id,user.id]);
   if(current.rows[0]?.object_key!==finalKey)await deleteObject(finalKey);
   throw err;
  }
  // Staging can be recreated by a still-live PUT but cannot affect READY.
  await deleteObject(stagingKey);
  send(res,200,{ok:true,id:file.id});return true;
  }finally{
   await releaseCompletionLease(pool,id,leaseToken);
  }
 }
 send(res,404,{error:'Not found'});return true;
}
