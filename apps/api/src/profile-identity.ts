// 1CE v2 profile identity. Private R2 avatar objects; never reuse v1 account tokens or storage.
import {randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {QueryableV2} from '../../../packages/shared/contracts.js';
import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {ensureProfileLinksV2,normalizeProfileLinksV2,storeProfileLinksV2} from './profile-links.js';

type DatabaseClientV2=QueryableV2&{release():void};
type DatabasePoolV2=QueryableV2&{connect():Promise<DatabaseClientV2>};
type AccountV2={id:number;[key:string]:unknown};
type SessionLookupV2=(req:IncomingMessage)=>Promise<AccountV2|null>;
type AvatarStoreV2={bucket:string;s3:S3Client};
type AvatarStorageFactoryV2=()=>AvatarStoreV2|null;
const maxAvatarBytes=5*1024*1024;
const send=(res:ServerResponse,status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const storageConfig=()=>({account:process.env.R2_ACCOUNT_ID,key:process.env.R2_ACCESS_KEY_ID,secret:process.env.R2_SECRET_ACCESS_KEY,bucket:process.env.R2_BUCKET_NAME});
function storage(){
 const c=storageConfig();
 if(!c.account||!c.key||!c.secret||!c.bucket)return null;
 return {bucket:c.bucket,s3:new S3Client({region:'auto',endpoint:'https://'+c.account+'.r2.cloudflarestorage.com',credentials:{accessKeyId:c.key,secretAccessKey:c.secret},forcePathStyle:true})};
}
export function normalizeUsername(value:unknown):string|null{
 if(typeof value!=='string')return null;
 const username=value.trim().replace(/^@/,'').toLowerCase();
 if(!/^[a-z0-9][a-z0-9._]{1,22}[a-z0-9]$/.test(username)||username.includes('..')||/^\d+$/.test(username))return null;
 return username;
}
export function detectAvatar(bytes:unknown):{type:'image/jpeg'|'image/png'|'image/webp';ext:'jpg'|'png'|'webp'}|null{
 if(!Buffer.isBuffer(bytes))return null;
 if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return {type:'image/jpeg',ext:'jpg'};
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {type:'image/png',ext:'png'};
 if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return {type:'image/webp',ext:'webp'};
 return null;
}
function avatarType(key:string):string|null{
 if(key.endsWith('.jpg'))return 'image/jpeg';
 if(key.endsWith('.png'))return 'image/png';
 if(key.endsWith('.webp'))return 'image/webp';
 return null;
}
async function readBytes(req:IncomingMessage,max:number):Promise<Buffer|null>{
 const declared=Number(req.headers['content-length']);
 if(Number.isFinite(declared)&&declared>max)return null;
 let size=0;const chunks:Buffer[]=[];
 for await(const chunk of req){size+=chunk.length;if(size>max)return null;chunks.push(chunk);}
 return Buffer.concat(chunks);
}
async function changeAvatar(pool:DatabasePoolV2,userId:number,newKey:string|null):Promise<{found:false}|{found:true;previous:string|null}>{
 const db=await pool.connect();
 let previous:string|null=null;
 try{
  await db.query('BEGIN');
  const old=await db.query('SELECT avatar_key FROM account_users WHERE id=$1 FOR UPDATE',[userId]);
  if(!old.rowCount){await db.query('ROLLBACK');return {found:false};}
  previous=old.rows[0].avatar_key as string|null;
  await db.query('UPDATE account_users SET avatar_key=$1,avatar_updated_at=now(),updated_at=now() WHERE id=$2',[newKey,userId]);
  await db.query('COMMIT');
  return {found:true,previous};
 }catch(error){try{await db.query('ROLLBACK');}catch{}throw error;}finally{db.release();}
}
async function removeOldAvatar(s3:S3Client,bucket:string,key:string|null,userId:number):Promise<void>{
 if(!key||!key.startsWith('users/'+userId+'/avatar/'))return;
 try{await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));}
 catch(error){console.error('Unable to remove obsolete v2 avatar:',(error as {message?:string}|null)?.message);}
}
export async function handleProfileIdentity(req:IncomingMessage,res:ServerResponse,pathname:string,pool:DatabasePoolV2,currentUser:SessionLookupV2,{storageFactory=storage}:{storageFactory?:AvatarStorageFactoryV2}={}):Promise<boolean>{
 const avatarMatch=/^\/api\/public\/avatar\/(\d+)$/.exec(pathname);
 if(avatarMatch){
  if(req.method!=='GET'){send(res,405,{error:'Method not allowed'});return true;}
  const id=avatarMatch[1];
  const result=await pool.query('SELECT avatar_key FROM account_users WHERE id=$1',[id]);
  const key=result.rows[0]?.avatar_key;
  const type=typeof key==='string'&&key.startsWith('users/'+id+'/avatar/')?avatarType(key):null;
  if(!type){send(res,404,{error:'Avatar not found'});return true;}
  const store=storageFactory();
  if(!store){send(res,503,{error:'Storage unavailable'});return true;}
  let object;
  try{object=await store.s3.send(new GetObjectCommand({Bucket:store.bucket,Key:key}));}
  catch(error){const failure=error as {name?:string;$metadata?:{httpStatusCode?:number}}|null;if(failure?.name==='NoSuchKey'||failure?.name==='NotFound'||failure?.$metadata?.httpStatusCode===404){send(res,404,{error:'Avatar not found'});return true;}throw error;}
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'public, no-store','X-Content-Type-Options':'nosniff'});
  for await(const chunk of (object.Body as AsyncIterable<Uint8Array>))res.write(chunk);
  res.end();return true;
 }
 if(pathname==='/auth/me'&&req.method==='PATCH'){
  const user=await currentUser(req);
  if(!user){send(res,401,{error:'Not authenticated'});return true;}
  const bytes=await readBytes(req,8192);
  if(!bytes){send(res,413,{error:'Request too large'});return true;}
  let data:Record<string,unknown>|null;try{data=JSON.parse(bytes.toString('utf8')) as Record<string,unknown>|null;}catch{send(res,400,{error:'Invalid JSON'});return true;}
  const changeUsername=Object.hasOwn(data||{},'username');
  const changeLinks=Object.hasOwn(data||{},'links');
  if(!changeUsername&&!changeLinks){send(res,400,{error:'No profile changes were provided.'});return true;}
  const username=changeUsername?normalizeUsername(data.username):null;
  if(changeUsername&&!username){
   send(res,400,{error:'Use 3–24 characters, beginning and ending with a letter or number; no spaces, repeated dots, or numbers-only usernames.'});return true;
  }
  const links=changeLinks?normalizeProfileLinksV2(data.links):null;
  if(changeLinks&&!links){send(res,400,{error:'Use up to 6 unique HTTPS profile links (maximum 500 characters each), without local addresses or credentials.'});return true;}
  // The existing endpoint owns profile mutations. If both fields are submitted,
  // keep username and social URLs atomic in the existing v2 database.
  if(changeLinks)await ensureProfileLinksV2(pool);
  const transaction=changeUsername&&changeLinks;
  const db=transaction?await pool.connect():pool;
  try{
   if(transaction)await db.query('BEGIN');
   if(changeUsername)await db.query('UPDATE account_users SET username=$1,updated_at=now() WHERE id=$2',[username,user.id]);
   if(changeLinks)await storeProfileLinksV2(db,user.id,links!);
   if(transaction)await db.query('COMMIT');
  }catch(error){
   if(transaction)try{await db.query('ROLLBACK');}catch{}
   if((error as {code?:string}|null)?.code==='23505'){send(res,409,{error:'This username is already taken.'});return true;}
   throw error;
  }finally{if(transaction)(db as DatabaseClientV2).release();}
  send(res,200,{user:await currentUser(req),...(changeLinks?{links}: {})});return true;
 }
 if(pathname==='/auth/me/avatar'){
  if(!['POST','DELETE'].includes(req.method)){send(res,405,{error:'Method not allowed'});return true;}
  const user=await currentUser(req);
  if(!user){send(res,401,{error:'Not authenticated'});return true;}
  const store=storageFactory();
  if(!store){send(res,503,{error:'Storage unavailable'});return true;}
  if(req.method==='DELETE'){
   const changed=await changeAvatar(pool,user.id,null);
   if(!changed.found){send(res,404,{error:'Account not found'});return true;}
   await removeOldAvatar(store.s3,store.bucket,changed.previous,user.id);
   send(res,200,{user:await currentUser(req)});return true;
  }
  const bytes=await readBytes(req,maxAvatarBytes);
  if(!bytes){send(res,413,{error:'Avatar must be smaller than 5 MB.'});return true;}
  const detected=detectAvatar(bytes);
  const declared=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  if(!detected||declared!==detected.type){send(res,415,{error:'Use a valid JPEG, PNG or WebP photo.'});return true;}
  const key='users/'+user.id+'/avatar/'+randomUUID()+'.'+detected.ext;
  await store.s3.send(new PutObjectCommand({Bucket:store.bucket,Key:key,Body:bytes,ContentType:detected.type,ContentLength:bytes.length}));
  let changed:Awaited<ReturnType<typeof changeAvatar>>;
  try{changed=await changeAvatar(pool,user.id,key);}
  catch(error){await removeOldAvatar(store.s3,store.bucket,key,user.id);throw error;}
  if(!changed.found){await removeOldAvatar(store.s3,store.bucket,key,user.id);send(res,404,{error:'Account not found'});return true;}
  await removeOldAvatar(store.s3,store.bucket,changed.previous,user.id);
  send(res,200,{user:await currentUser(req)});return true;
 }
 return false;
}
