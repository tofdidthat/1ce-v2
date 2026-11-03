// Private Cloudflare R2 uploads for 1CE v2 only. No v1 resources.
import { randomUUID, createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import {verifyUploadedObject,InvalidMedia,VerificationUnavailable} from './upload-security.js';
import {rateLimitExceeded,uploadLimits} from './api-rate-limits.js';
import {accountStorageQuota} from './storage-plans.js';
import {acquireCompletionLease,releaseCompletionLease,promoteReadyWithLease} from './upload-leases.js';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {resolveAuthorizedMediaFile} from './project-media.js';
import {streamAuthorizedAudio} from './audio-stream.js';

const limits={audio:150*1024*1024,cover:15*1024*1024,stems:250*1024*1024};
const types={
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
function client(){
 const c=config();
 if(!c.account||!c.key||!c.secret||!c.bucket) return null;
 return new S3Client({region:'auto',endpoint:'https://'+c.account+'.r2.cloudflarestorage.com',
 credentials:{accessKeyId:c.key,secretAccessKey:c.secret},forcePathStyle:true});
}
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function bodyJSON(req){
 let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8192)throw new Error('Request too large');}
 try{return JSON.parse(raw)}catch{throw new Error('Invalid JSON');}
}
// Optional dependencies are for request-level regression tests; in production
// the exact same private R2 client and presigner are used as before.
export async function handleLibraryFiles(req,res,pathname,pool,currentUser,{
 storageFactory=()=>({s3:client(),bucket:config().bucket}),
 signUrl=getSignedUrl
}={}){
 if(!pathname.startsWith('/api/library/files'))return false;
 if(!['GET','POST'].includes(req.method)){send(res,405,{error:'Method not allowed'});return true;}
 const user=await currentUser(req);
 if(!user){send(res,401,{error:'Not authenticated'});return true;}
 const {s3,bucket}=storageFactory(),cfg={bucket};
 if(!s3){send(res,503,{error:'Storage is not configured'});return true;}
 const segments=pathname.split('/').filter(Boolean);
 if(req.method==='POST'&&segments.length===4&&segments[3]==='beats'){
  let data;try{data=await bodyJSON(req)}catch{send(res,400,{error:'Invalid request'});return true;}
  const title=typeof data?.title==='string'?data.title.trim():'';
  if(!title||title.length>180||!Number.isSafeInteger(data.audioFileId)||data.audioFileId<1){send(res,400,{error:'Invalid beat'});return true;}
  const ids=[data.audioFileId,data.coverFileId,data.stemsFileId].filter(x=>x!=null);
  if(ids.some(x=>!Number.isSafeInteger(x)||x<1)){send(res,400,{error:'Invalid asset IDs'});return true;}
  const q=await pool.query("SELECT id,kind FROM library_files WHERE user_id=$1 AND status='ready' AND id=ANY($2::bigint[])",[user.id,ids]);
  const valid=new Map(q.rows.map(x=>[Number(x.id),x.kind]));
  if(valid.get(data.audioFileId)!=='audio'||data.coverFileId!=null&&valid.get(data.coverFileId)!=='cover'||data.stemsFileId!=null&&valid.get(data.stemsFileId)!=='stems'){send(res,400,{error:'Assets must be owned by you and ready'});return true;}
  const existing=await pool.query("SELECT id FROM library_beats WHERE user_id=$1 AND audio_file_id=$2",[user.id,data.audioFileId]);
  if(existing.rows[0]){send(res,200,{id:existing.rows[0].id,reused:true});return true;}
  const id=randomUUID();
  await pool.query("INSERT INTO library_beats(id,user_id,title,audio_file_id,cover_file_id,stems_file_id) VALUES($1,$2,$3,$4,$5,$6)",[id,user.id,title,data.audioFileId,data.coverFileId||null,data.stemsFileId||null]);
  send(res,201,{id});return true;
 }
 if(req.method==='POST'&&segments.length===4&&segments[3]==='packs'){
  let data;try{data=await bodyJSON(req)}catch{send(res,400,{error:'Invalid request'});return true;}
  const title=typeof data?.title==='string'?data.title.trim():'';
  const beatIds=data?.beatIds;
  const newBeatIds=data?.newBeatIds||[];
  if(!title||title.length>180||!Array.isArray(beatIds)||beatIds.length<2||beatIds.length>100||new Set(beatIds).size!==beatIds.length||beatIds.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))){send(res,400,{error:'Invalid pack'});return true;}
  if(!Array.isArray(newBeatIds)||new Set(newBeatIds).size!==newBeatIds.length||newBeatIds.some(id=>!beatIds.includes(id))){send(res,400,{error:'Invalid new beat IDs'});return true;}
  if(data.coverFileId!=null&&(!Number.isSafeInteger(data.coverFileId)||data.coverFileId<1)){send(res,400,{error:'Invalid cover'});return true;}
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const owned=await client.query('SELECT id FROM library_beats WHERE user_id=$1 AND id=ANY($2::uuid[])',[user.id,beatIds]);
   if(owned.rowCount!==beatIds.length){await client.query('ROLLBACK');send(res,403,{error:'Beat not owned by you'});return true;}
   if(data.coverFileId!=null){
    const cover=await client.query("SELECT id FROM library_files WHERE id=$1 AND user_id=$2 AND kind='cover' AND status='ready'",[data.coverFileId,user.id]);
    if(!cover.rowCount){await client.query('ROLLBACK');send(res,403,{error:'Cover not owned by you'});return true;}
   }
   const id=randomUUID();
   await client.query('INSERT INTO library_packs(id,user_id,title,cover_file_id) VALUES($1,$2,$3,$4)',[id,user.id,title,data.coverFileId||null]);
   for(let i=0;i<beatIds.length;i++)await client.query('INSERT INTO library_pack_beats(pack_id,beat_id,position) VALUES($1,$2,$3)',[id,beatIds[i],i]);
   if(newBeatIds.length)await client.query('UPDATE library_beats SET library_visible=FALSE WHERE user_id=$1 AND id=ANY($2::uuid[]) AND library_visible=TRUE',[user.id,newBeatIds]);
   await client.query('COMMIT');send(res,201,{id});return true;
  }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
 }
 if(req.method==='GET'&&segments.length===5&&segments[3]==='audio'&&/^\d+$/.test(segments[4])){
  const id=segments[4];
  const file=await resolveAuthorizedMediaFile(pool,{ownerId:user.id,viewerId:user.id,fileId:id,kind:'audio'});
  if(!file){send(res,404,{error:'Audio not found'});return true;}
  await streamAuthorizedAudio(req,res,{file,s3,bucket:cfg.bucket});return true;
 }
 if(req.method==='GET'&&segments.length===5&&segments[3]==='pack-tracks'&&/^[a-f0-9-]{36}$/i.test(segments[4])){
  const q=await pool.query(`SELECT b.id,b.title,b.audio_file_id,b.cover_file_id,b.stems_file_id
   FROM library_packs p JOIN library_pack_beats pb ON pb.pack_id=p.id
   JOIN library_beats b ON b.id=pb.beat_id AND b.user_id=p.user_id
   JOIN library_files f ON f.id=b.audio_file_id AND f.status='ready'
   WHERE p.id=$1 AND p.user_id=$2 ORDER BY pb.position ASC`,[segments[4],user.id]);
  send(res,200,{beats:q.rows});return true;
 }
 if(req.method==='GET'&&segments.length===4&&segments[3]==='items'){
  const [beats,packs]=await Promise.all([
   pool.query(`SELECT b.id,b.title,b.created_at,b.audio_file_id,b.cover_file_id,b.stems_file_id,b.library_visible,
     a.original_name AS audio_name,a.byte_size AS audio_size,
     (SELECT count(*)::int FROM library_pack_beats pb WHERE pb.beat_id=b.id) AS pack_count
     FROM library_beats b JOIN library_files a ON a.id=b.audio_file_id AND a.status='ready'
     WHERE b.user_id=$1 ORDER BY b.created_at DESC LIMIT 200`,[user.id]),
   pool.query(`SELECT p.id,p.title,p.created_at,p.cover_file_id,
     COUNT(pb.beat_id)::int AS track_count
     FROM library_packs p LEFT JOIN library_pack_beats pb ON pb.pack_id=p.id
     WHERE p.user_id=$1 GROUP BY p.id ORDER BY p.created_at DESC LIMIT 100`,[user.id])
  ]);
  send(res,200,{beats:beats.rows,packs:packs.rows});return true;
 }
 if(req.method==='GET'&&segments.length===5&&segments[3]==='cover'&&/^\d+$/.test(segments[4])){
  const id=segments[4];
  const file=await resolveAuthorizedMediaFile(pool,{ownerId:user.id,viewerId:user.id,fileId:id,kind:'cover'});
  if(!file){send(res,404,{error:'Cover not found'});return true;}
  const object=await s3.send(new GetObjectCommand({Bucket:cfg.bucket,Key:file.object_key}));
  res.writeHead(200,{'Content-Type':file.content_type,'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'});
  for await(const chunk of object.Body)res.write(chunk);
  res.end();return true;
 }
 if(req.method==='GET'&&segments.length===3){
  const q=await pool.query("SELECT id,kind,original_name,content_type,byte_size,created_at FROM library_files WHERE user_id=$1 AND status='ready' ORDER BY created_at DESC LIMIT 100",[user.id]);
  send(res,200,{files:q.rows});return true;
 }
 if(req.method==='POST'&&segments.length===4&&segments[3]==='init'){
  let data;try{data=await bodyJSON(req)}catch{send(res,400,{error:'Invalid request'});return true;}
  const {kind,name,contentType,size,sha256}=data||{};
  const ext=typeof name==='string'?name.toLowerCase().split('.').pop():'';
  if(!Object.hasOwn(limits,kind)||typeof name!=='string'||name.length>240||name.length<1||/[\\/\x00-\x1f]/.test(name)||
   typeof contentType!=='string'||!types[kind]?.[contentType]?.includes(ext)||
   !Number.isSafeInteger(size)||size<=0||size>limits[kind]||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)){
   send(res,400,{error:'Unsupported file type or size'});return true;
  }
  // Serialize per-owner reservations across replicas. Only pending keys
  // receive signed PUT URLs; verified keys are never writable by clients.
  if(await rateLimitExceeded(pool,'upload-init',user.id,uploadLimits.initPerHour,60)){
   send(res,429,{error:'Upload rate limit reached'});return true;
  }
  const db=await pool.connect();
  let inserted,objectKey;
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
  const file=q.rows[0];
  if(!file){send(res,404,{error:'File not found'});return true;}
  if(file.status==='ready'){send(res,200,{ok:true,id:file.id});return true;}
  if(file.status!=='pending'){send(res,409,{error:'Invalid upload state'});return true;}
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
  const deleteObject=async key=>{
   try{await s3.send(new DeleteObjectCommand({Bucket:cfg.bucket,Key:key}),{abortSignal:AbortSignal.timeout(15000)});}
   catch(err){console.error('R2 cleanup deferred',err?.message);}
  };
  try{
   const head=await s3.send(new HeadObjectCommand({Bucket:cfg.bucket,Key:stagingKey}),{abortSignal:AbortSignal.timeout(15000)});
   if(Number(head.ContentLength)!==Number(file.byte_size)||head.ContentType!==file.content_type){
    await pool.query("UPDATE library_files SET status='failed',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='pending'",[id,user.id]);
    await deleteObject(stagingKey);
    send(res,422,{error:'Uploaded file metadata did not match'});return true;
   }
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
   await deleteObject(finalKey);
   if(err instanceof InvalidMedia){
    await pool.query("UPDATE library_files SET status='failed',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='pending'",[id,user.id]);
    await deleteObject(stagingKey);
    send(res,422,{error:err.message});return true;
   }
   if(err?.name==='NotFound'||err?.$metadata?.httpStatusCode===404){
    send(res,409,{error:'Upload not found in storage'});return true;
   }
   if(err?.$metadata?.httpStatusCode===412){
    send(res,409,{error:'Upload changed during verification; retry'});return true;
   }
   if(err instanceof VerificationUnavailable||err?.name==='AbortError'){
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
   if(err?.code==='23505'){
    const existing=await pool.query("SELECT id FROM library_files WHERE user_id=$1 AND kind=$2 AND sha256=$3 AND status='ready'",[user.id,file.kind,file.sha256]);
    if(existing.rows[0]){
     await deleteObject(finalKey);
     await deleteObject(stagingKey);
     await pool.query("DELETE FROM library_files WHERE id=$1 AND user_id=$2 AND status='pending'",[id,user.id]);
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
