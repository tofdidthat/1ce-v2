// Private Cloudflare R2 uploads for 1CE v2 only. No v1 resources.
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
export async function handleLibraryFiles(req,res,pathname,pool,currentUser){
 if(!pathname.startsWith('/api/library/files'))return false;
 if(!['GET','POST'].includes(req.method)){send(res,405,{error:'Method not allowed'});return true;}
 const user=await currentUser(req);
 if(!user){send(res,401,{error:'Not authenticated'});return true;}
 const s3=client(),cfg=config();
 if(!s3){send(res,503,{error:'Storage is not configured'});return true;}
 const segments=pathname.split('/').filter(Boolean);
 if(req.method==='GET'&&segments.length===3){
  const q=await pool.query("SELECT id,kind,original_name,content_type,byte_size,created_at FROM library_files WHERE user_id=$1 AND status='ready' ORDER BY created_at DESC LIMIT 100",[user.id]);
  send(res,200,{files:q.rows});return true;
 }
 if(req.method==='POST'&&segments.length===4&&segments[3]==='init'){
  let data;try{data=await bodyJSON(req)}catch{send(res,400,{error:'Invalid request'});return true;}
  const {kind,name,contentType,size}=data||{};
  const ext=typeof name==='string'?name.toLowerCase().split('.').pop():'';
  if(!Object.hasOwn(limits,kind)||typeof name!=='string'||name.length>240||name.length<1||/[\\/\x00-\x1f]/.test(name)||
   typeof contentType!=='string'||!types[kind]?.[contentType]?.includes(ext)||
   !Number.isSafeInteger(size)||size<=0||size>limits[kind]){
   send(res,400,{error:'Unsupported file type or size'});return true;
  }
  const objectKey='users/'+user.id+'/'+kind+'/'+randomUUID()+'.'+ext;
  const inserted=await pool.query("INSERT INTO library_files(user_id,kind,object_key,original_name,content_type,byte_size,status) VALUES($1,$2,$3,$4,$5,$6,'pending') RETURNING id",[user.id,kind,objectKey,name,contentType,size]);
  try{
   const uploadUrl=await getSignedUrl(s3,new PutObjectCommand({Bucket:cfg.bucket,Key:objectKey,ContentType:contentType,ContentLength:size}),{expiresIn:300});
   send(res,200,{id:inserted.rows[0].id,uploadUrl,expiresIn:300});
  }catch(err){
   await pool.query("DELETE FROM library_files WHERE id=$1 AND user_id=$2 AND status='pending'",[inserted.rows[0].id,user.id]);
   throw err;
  }
  return true;
 }
 if(req.method==='POST'&&segments.length===5&&segments[4]==='complete'&&/^\d+$/.test(segments[3])){
  const id=segments[3];
  const q=await pool.query('SELECT id,object_key,content_type,byte_size,status FROM library_files WHERE id=$1 AND user_id=$2',[id,user.id]);
  const file=q.rows[0];
  if(!file){send(res,404,{error:'File not found'});return true;}
  if(file.status==='ready'){send(res,200,{ok:true,id:file.id});return true;}
  if(file.status!=='pending'){send(res,409,{error:'Invalid upload state'});return true;}
  try{
   const head=await s3.send(new HeadObjectCommand({Bucket:cfg.bucket,Key:file.object_key}));
   if(Number(head.ContentLength)!==Number(file.byte_size)||head.ContentType!==file.content_type){
    await s3.send(new DeleteObjectCommand({Bucket:cfg.bucket,Key:file.object_key}));
    await pool.query("UPDATE library_files SET status='failed',updated_at=now() WHERE id=$1 AND user_id=$2",[id,user.id]);
    send(res,422,{error:'Uploaded file metadata did not match'});return true;
   }
  }catch(err){
   if(err?.name==='NotFound'||err?.$metadata?.httpStatusCode===404){send(res,409,{error:'Upload not found in storage'});return true;}
   throw err;
  }
  await pool.query("UPDATE library_files SET status='ready',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='pending'",[id,user.id]);
  send(res,200,{ok:true,id:file.id});return true;
 }
 send(res,404,{error:'Not found'});return true;
}
