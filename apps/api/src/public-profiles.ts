import {randomBytes,createHash} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {ProjectKindV2,QueryableV2} from '../../../packages/shared/contracts.js';
import {S3Client,GetObjectCommand} from '@aws-sdk/client-s3';
import {resolveAuthorizedMediaFile,resolvePlayableProject} from './project-media.js';
import {streamAuthorizedAudio} from './audio-stream.js';
import {readProfileLinksV2} from './profile-links.js';
// 1CE v2 public profile catalog and public saves. Metadata only; R2 objects are never duplicated.
type DatabaseClientV2=QueryableV2&{release():void};
type DatabasePoolV2=QueryableV2&{connect():Promise<DatabaseClientV2>};
type AccountV2={id:number};
type SessionLookupV2=(req:IncomingMessage)=>Promise<AccountV2|null>;
type PublicMutationV2={status:number;data:unknown};
const send=(res:ServerResponse,status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ownerResult=(status:number,data:unknown):PublicMutationV2=>({status,data});
// Serialize publication/save/share writes with move-to-Trash, restore and permanent purge.
// Mutations must re-check live project state *after* acquiring this lock.
async function ownerMutation(pool:DatabasePoolV2,owner:number,work:(db:DatabaseClientV2)=>Promise<PublicMutationV2>):Promise<PublicMutationV2>{
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock($1::bigint)',[owner]);
  const result=await work(db);
  await db.query(result.status>=400?'ROLLBACK':'COMMIT');
  return result;
 }catch(error){try{await db.query('ROLLBACK');}catch{}throw error;}
 finally{db.release();}
}
let initialized:Promise<void>|null|undefined;
function ready(pool:DatabasePoolV2):Promise<void>{
 if(!initialized)initialized=(async()=>{
  await pool.query(`CREATE TABLE IF NOT EXISTS v2_public_projects (
   user_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
   kind TEXT NOT NULL CHECK(kind IN ('beat','pack')),
   project_id UUID NOT NULL,
   published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
   PRIMARY KEY (user_id,kind,project_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS v2_public_saves (
   user_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
   owner_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
   kind TEXT NOT NULL CHECK(kind IN ('beat','pack')),
   project_id UUID NOT NULL,
   saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
   PRIMARY KEY (user_id,owner_id,kind,project_id)
  )`);
  await pool.query("CREATE TABLE IF NOT EXISTS v2_project_access (owner_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,viewer_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('beat','pack')),project_id UUID NOT NULL,granted_at TIMESTAMPTZ DEFAULT now(),PRIMARY KEY(owner_id,viewer_id,kind,project_id))");
  await pool.query("CREATE TABLE IF NOT EXISTS v2_project_share_links (token_hash TEXT PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('beat','pack')),project_id UUID NOT NULL,created_at TIMESTAMPTZ DEFAULT now())");
  await pool.query('CREATE INDEX IF NOT EXISTS v2_public_saves_owner_idx ON v2_public_saves(owner_id,kind,project_id)');
 })().catch(err=>{initialized=null;throw err});
 return initialized!;
}
const selectProjects=`SELECT pub.kind,pub.project_id AS id,pub.user_id AS owner_id,
 CASE WHEN pub.kind='beat' THEN b.title ELSE p.title END AS title,
 CASE WHEN pub.kind='beat' THEN b.cover_file_id ELSE p.cover_file_id END AS cover_file_id,
 CASE WHEN pub.kind='pack' THEN (SELECT count(*)::int FROM library_pack_beats pb WHERE pb.pack_id=p.id) ELSE NULL END AS track_count,
 pub.published_at
 FROM v2_public_projects pub
 LEFT JOIN library_beats b ON pub.kind='beat' AND b.id=pub.project_id AND b.user_id=pub.user_id AND b.deleted_at IS NULL
 LEFT JOIN library_packs p ON pub.kind='pack' AND p.id=pub.project_id AND p.user_id=pub.user_id AND p.deleted_at IS NULL
 WHERE (b.id IS NOT NULL OR p.id IS NOT NULL)`;
export async function handlePublicProfiles(req:IncomingMessage,res:ServerResponse,pathname:string,pool:DatabasePoolV2,currentUser:SessionLookupV2):Promise<boolean>{
 if(!pathname.startsWith('/api/public/'))return false;
 if(!['GET','POST','DELETE'].includes(req.method||'')){send(res,405,{error:'Method not allowed'});return true;}
 await ready(pool);
 const parts=pathname.split('/').filter(Boolean);
 const user=await currentUser(req);

 // The original media stays private in R2. These are the minimal missing
 // cross-owner playback adapters; all access is checked in project-media.js.
 if(parts.length===5&&parts[2]==='audio'&&/^\d+$/.test(parts[3])&&/^\d+$/.test(parts[4])&&req.method==='GET'){
  const owner=parts[3],fileId=parts[4];
  const file=await resolveAuthorizedMediaFile(pool,{ownerId:owner,viewerId:user?.id,fileId,kind:'audio'});
  if(!file){send(res,404,{error:'Audio not found'});return true;}
  const cfg={account:process.env.R2_ACCOUNT_ID,key:process.env.R2_ACCESS_KEY_ID,secret:process.env.R2_SECRET_ACCESS_KEY,bucket:process.env.R2_BUCKET_NAME};
  if(!cfg.account||!cfg.key||!cfg.secret||!cfg.bucket){send(res,503,{error:'Storage unavailable'});return true;}
  const s3=new S3Client({region:'auto',endpoint:'https://'+cfg.account+'.r2.cloudflarestorage.com',credentials:{accessKeyId:cfg.key,secretAccessKey:cfg.secret},forcePathStyle:true});
  await streamAuthorizedAudio(req,res,{file,s3,bucket:cfg.bucket});return true;
 }
 if(parts.length===6&&parts[2]==='play'&&/^\d+$/.test(parts[3])&&['beat','pack'].includes(parts[4])&&uuid.test(parts[5])&&req.method==='GET'){
  const project=await resolvePlayableProject(pool,{ownerId:parts[3],viewerId:user?.id,kind:parts[4] as ProjectKindV2,projectId:parts[5]});
  if(!project){send(res,404,{error:'Project not available for playback'});return true;}
  send(res,200,{project});return true;
 }
 if(parts.length===5&&parts[2]==='cover'&&/^\d+$/.test(parts[3])&&/^\d+$/.test(parts[4])&&req.method==='GET'){
  const owner=parts[3],fileId=parts[4];
  const file=await resolveAuthorizedMediaFile(pool,{ownerId:owner,viewerId:user?.id,fileId,kind:'cover'});
  if(!file){send(res,404,{error:'Cover not found'});return true;}
  const cfg={account:process.env.R2_ACCOUNT_ID,key:process.env.R2_ACCESS_KEY_ID,secret:process.env.R2_SECRET_ACCESS_KEY,bucket:process.env.R2_BUCKET_NAME};
  if(!cfg.account||!cfg.key||!cfg.secret||!cfg.bucket){send(res,503,{error:'Storage unavailable'});return true;}
  const s3=new S3Client({region:'auto',endpoint:'https://'+cfg.account+'.r2.cloudflarestorage.com',credentials:{accessKeyId:cfg.key,secretAccessKey:cfg.secret},forcePathStyle:true});
  const obj=await s3.send(new GetObjectCommand({Bucket:cfg.bucket,Key:file.object_key}));
  res.writeHead(200,{'Content-Type':file.content_type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
  for await(const chunk of (obj.Body as AsyncIterable<Uint8Array>))res.write(chunk);
  res.end();return true;
 }
 if(parts.length===4&&parts[2]==='profile'&&req.method==='GET'){
  const slug=parts[3].toLowerCase();
  const byId=/^[0-9]+$/.test(slug);
  if(!byId&&!/^[a-z0-9][a-z0-9._]{1,22}[a-z0-9]$/.test(slug)){send(res,404,{error:'Profile not found'});return true;}
  const numericId=Number(slug);
  if(byId&&(!Number.isSafeInteger(numericId)||numericId>2147483647)){send(res,404,{error:'Profile not found'});return true;}
  const profile=await pool.query(
   'SELECT id,name,picture,username,(avatar_key IS NOT NULL) AS has_avatar,avatar_updated_at FROM account_users WHERE '+(byId?'id=$1':'username=$1'),
   [byId?numericId:slug]
  );
  if(!profile.rowCount){send(res,404,{error:'Profile not found'});return true;}
  const profileId=profile.rows[0].id as number;
  const [catalog,saves,links]=await Promise.all([
   
   pool.query(selectProjects+' AND pub.user_id=$1 ORDER BY pub.published_at DESC LIMIT 200',[profileId]),
   pool.query(`SELECT s.kind,s.project_id AS id,s.owner_id,COALESCE(b.title,p.title) AS title,COALESCE(b.cover_file_id,p.cover_file_id) AS cover_file_id,
    CASE WHEN s.kind='pack' THEN (SELECT count(*)::int FROM library_pack_beats pb WHERE pb.pack_id=p.id) ELSE NULL END AS track_count,s.saved_at AS published_at
    FROM v2_public_saves s
    LEFT JOIN library_beats b ON s.kind='beat' AND b.id=s.project_id AND b.user_id=s.owner_id AND b.deleted_at IS NULL
    LEFT JOIN library_packs p ON s.kind='pack' AND p.id=s.project_id AND p.user_id=s.owner_id AND p.deleted_at IS NULL
    WHERE s.user_id=$1 AND (b.id IS NOT NULL OR p.id IS NOT NULL)
    -- A saved private project belongs to the saver's personal Saves view.
    -- A project owner or a separately granted viewer must not discover
    -- private saves on someone else's profile. Publication alone makes
    -- the saved entry eligible for public display.
    AND (s.user_id=$2 OR EXISTS(SELECT 1 FROM v2_public_projects pub WHERE pub.user_id=s.owner_id AND pub.kind=s.kind AND pub.project_id=s.project_id))
    ORDER BY s.saved_at DESC LIMIT 200`,[profileId,user?.id||null]),
   readProfileLinksV2(pool,profileId)
  ]);
  send(res,200,{profile:{...profile.rows[0],links},catalog:catalog.rows,saves:saves.rows});return true;
 }
 if(!user){send(res,401,{error:'Not authenticated'});return true;}
 if(parts.length===5&&parts[2]==='share'&&['beat','pack'].includes(parts[3])&&uuid.test(parts[4])&&req.method==='POST'){
  const kind=parts[3],id=parts[4],table=kind==='beat'?'library_beats':'library_packs';
  const token=randomBytes(32).toString('base64url');
  const response=await ownerMutation(pool,user.id,async db=>{
   const owned=await db.query('SELECT 1 FROM '+table+' WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL',[id,user.id]);
   if(!owned.rowCount)return ownerResult(404,{error:'Project not found'});
   await db.query('INSERT INTO v2_project_share_links(token_hash,owner_id,kind,project_id) VALUES($1,$2,$3,$4)',[createHash('sha256').update(token).digest('hex'),user.id,kind,id]);
   return ownerResult(200,{token});
  });
  send(res,response.status,response.data);return true;
 }
 if(parts.length===4&&parts[2]==='redeem'&&req.method==='POST'&&/^[A-Za-z0-9_-]{43}$/.test(parts[3])){
  const hash=createHash('sha256').update(parts[3]).digest('hex');
  // Read owner only to choose advisory lock; re-read the link inside the lock.
  const candidate=await pool.query('SELECT owner_id FROM v2_project_share_links WHERE token_hash=$1',[hash]);
  if(!candidate.rowCount){send(res,404,{error:'Invalid share link'});return true;}
  const response=await ownerMutation(pool,candidate.rows[0].owner_id as number,async db=>{
   const link=await db.query('SELECT owner_id,kind,project_id FROM v2_project_share_links WHERE token_hash=$1',[hash]);
   if(!link.rowCount)return ownerResult(404,{error:'Invalid share link'});
   const {owner_id,kind,project_id}=link.rows[0];
   if(!['beat','pack'].includes(kind))return ownerResult(404,{error:'Invalid share link'});
   const table=kind==='beat'?'library_beats':'library_packs';
   const exists=await db.query('SELECT 1 FROM '+table+' WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL',[owner_id,project_id]);
   if(!exists.rowCount)return ownerResult(404,{error:'Project not found'});
   await db.query('INSERT INTO v2_project_access(owner_id,viewer_id,kind,project_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[owner_id,user.id,kind,project_id]);
   return ownerResult(200,{ok:true,owner_id,kind,id:project_id});
  });
  send(res,response.status,response.data);return true;
 }
 if(parts.length===3&&parts[2]==='mine'&&req.method==='GET'){
  const [published,saved]=await Promise.all([
   pool.query('SELECT kind,project_id AS id FROM v2_public_projects WHERE user_id=$1',[user.id]),
   pool.query('SELECT owner_id,kind,project_id AS id FROM v2_public_saves WHERE user_id=$1',[user.id])
  ]);
  send(res,200,{published:published.rows,saved:saved.rows});return true;
 }
 if(parts.length===5&&parts[2]==='publish'&&['beat','pack'].includes(parts[3])&&uuid.test(parts[4])&&['POST','DELETE'].includes(req.method||'')){
  const kind=parts[3],id=parts[4],table=kind==='beat'?'library_beats':'library_packs';
  const response=await ownerMutation(pool,user.id,async db=>{
   const owned=await db.query('SELECT id FROM '+table+' WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL',[id,user.id]);
   if(!owned.rowCount)return ownerResult(404,{error:'Project not found'});
   if(req.method==='POST')await db.query('INSERT INTO v2_public_projects(user_id,kind,project_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[user.id,kind,id]);
   else await db.query('DELETE FROM v2_public_projects WHERE user_id=$1 AND kind=$2 AND project_id=$3',[user.id,kind,id]);
   return ownerResult(200,{ok:true,published:req.method==='POST'});
  });
  send(res,response.status,response.data);return true;
 }
 if(parts.length===6&&parts[2]==='save'&&/^\d+$/.test(parts[3])&&['beat','pack'].includes(parts[4])&&uuid.test(parts[5])&&['POST','DELETE'].includes(req.method||'')){
  const [, , ,ownerText,kind,id]=parts;
  const owner=Number(ownerText);
  if(!Number.isSafeInteger(owner)||owner<1||owner>2147483647){send(res,404,{error:'Project not found'});return true;}
  const table=kind==='beat'?'library_beats':'library_packs';
  const response=await ownerMutation(pool,owner,async db=>{
   if(req.method==='POST'){
    const allowed=await db.query(`SELECT 1 FROM ${table} p WHERE p.user_id=$2::integer AND p.id=$4::uuid AND p.deleted_at IS NULL
     AND ($1::integer=$2::integer
      OR EXISTS(SELECT 1 FROM v2_public_projects WHERE user_id=$2 AND kind=$3 AND project_id=$4)
      OR EXISTS(SELECT 1 FROM v2_project_access WHERE viewer_id=$1 AND owner_id=$2 AND kind=$3 AND project_id=$4))`,[user.id,owner,kind,id]);
    if(!allowed.rowCount)return ownerResult(403,{error:'Access required'});
    await db.query('INSERT INTO v2_public_saves(user_id,owner_id,kind,project_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[user.id,owner,kind,id]);
   }else{
    await db.query('DELETE FROM v2_public_saves WHERE user_id=$1 AND owner_id=$2 AND kind=$3 AND project_id=$4',[user.id,owner,kind,id]);
   }
   return ownerResult(200,{ok:true,saved:req.method==='POST'});
  });
  send(res,response.status,response.data);return true;
 }
 send(res,404,{error:'Not found'});return true;
}
