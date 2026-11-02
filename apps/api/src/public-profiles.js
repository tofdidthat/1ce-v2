import {S3Client,GetObjectCommand} from '@aws-sdk/client-s3';
// 1CE v2 public profile catalog and public saves. Metadata only; R2 objects are never duplicated.
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let initialized;
function ready(pool){
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
  await pool.query('CREATE INDEX IF NOT EXISTS v2_public_saves_owner_idx ON v2_public_saves(owner_id,kind,project_id)');
 })().catch(err=>{initialized=null;throw err});
 return initialized;
}
const selectProjects=`SELECT pub.kind,pub.project_id AS id,pub.user_id AS owner_id,
 CASE WHEN pub.kind='beat' THEN b.title ELSE p.title END AS title,
 CASE WHEN pub.kind='beat' THEN b.cover_file_id ELSE p.cover_file_id END AS cover_file_id,
 CASE WHEN pub.kind='pack' THEN (SELECT count(*)::int FROM library_pack_beats pb WHERE pb.pack_id=p.id) ELSE NULL END AS track_count,
 pub.published_at
 FROM v2_public_projects pub
 LEFT JOIN library_beats b ON pub.kind='beat' AND b.id=pub.project_id AND b.user_id=pub.user_id
 LEFT JOIN library_packs p ON pub.kind='pack' AND p.id=pub.project_id AND p.user_id=pub.user_id
 WHERE (b.id IS NOT NULL OR p.id IS NOT NULL)`;
export async function handlePublicProfiles(req,res,pathname,pool,currentUser){
 if(!pathname.startsWith('/api/public/'))return false;
 if(!['GET','POST','DELETE'].includes(req.method)){send(res,405,{error:'Method not allowed'});return true;}
 await ready(pool);
 const parts=pathname.split('/').filter(Boolean);
 if(parts.length===5&&parts[2]==='cover'&&/^\d+$/.test(parts[3])&&/^\d+$/.test(parts[4])&&req.method==='GET'){
  const owner=parts[3],fileId=parts[4];
  const q=await pool.query(`SELECT f.object_key,f.content_type FROM library_files f WHERE f.id=$1 AND f.user_id=$2 AND f.kind='cover' AND f.status='ready'
   AND EXISTS (SELECT 1 FROM v2_public_projects pub LEFT JOIN library_beats b ON pub.kind='beat' AND b.id=pub.project_id AND b.user_id=pub.user_id LEFT JOIN library_packs p ON pub.kind='pack' AND p.id=pub.project_id AND p.user_id=pub.user_id
    WHERE pub.user_id=$2 AND COALESCE(b.cover_file_id,p.cover_file_id)=$1) LIMIT 1`,[fileId,owner]);
  if(!q.rowCount){send(res,404,{error:'Cover not found'});return true;}
  const cfg={account:process.env.R2_ACCOUNT_ID,key:process.env.R2_ACCESS_KEY_ID,secret:process.env.R2_SECRET_ACCESS_KEY,bucket:process.env.R2_BUCKET_NAME};
  if(!cfg.account||!cfg.key||!cfg.secret||!cfg.bucket){send(res,503,{error:'Storage unavailable'});return true;}
  const s3=new S3Client({region:'auto',endpoint:'https://'+cfg.account+'.r2.cloudflarestorage.com',credentials:{accessKeyId:cfg.key,secretAccessKey:cfg.secret},forcePathStyle:true});
  const obj=await s3.send(new GetObjectCommand({Bucket:cfg.bucket,Key:q.rows[0].object_key}));
  res.writeHead(200,{'Content-Type':q.rows[0].content_type,'Cache-Control':'public,max-age=120','X-Content-Type-Options':'nosniff'});
  for await(const chunk of obj.Body)res.write(chunk);
  res.end();return true;
 }
 const user=await currentUser(req);
 if(parts.length===4&&parts[2]==='profile'&&/^\d+$/.test(parts[3])&&req.method==='GET'){
  const profileId=parts[3];
  const [profile,catalog,saves]=await Promise.all([
   pool.query('SELECT id,name,picture,custom_picture FROM account_users WHERE id=$1',[profileId]),
   pool.query(selectProjects+' AND pub.user_id=$1 ORDER BY pub.published_at DESC LIMIT 200',[profileId]),
   pool.query(`SELECT projects.* FROM v2_public_saves s JOIN LATERAL (${selectProjects} AND pub.user_id=s.owner_id AND pub.kind=s.kind AND pub.project_id=s.project_id) projects ON TRUE WHERE s.user_id=$1 ORDER BY s.saved_at DESC LIMIT 200`,[profileId])
  ]);
  if(!profile.rowCount){send(res,404,{error:'Profile not found'});return true;}
  send(res,200,{profile:profile.rows[0],catalog:catalog.rows,saves:saves.rows});return true;
 }
 if(!user){send(res,401,{error:'Not authenticated'});return true;}
 if(parts.length===3&&parts[2]==='mine'&&req.method==='GET'){
  const [published,saved]=await Promise.all([
   pool.query('SELECT kind,project_id AS id FROM v2_public_projects WHERE user_id=$1',[user.id]),
   pool.query('SELECT owner_id,kind,project_id AS id FROM v2_public_saves WHERE user_id=$1',[user.id])
  ]);
  send(res,200,{published:published.rows,saved:saved.rows});return true;
 }
 if(parts.length===5&&parts[2]==='publish'&&['beat','pack'].includes(parts[3])&&uuid.test(parts[4])&&['POST','DELETE'].includes(req.method)){
  const kind=parts[3],id=parts[4],table=kind==='beat'?'library_beats':'library_packs';
  const owned=await pool.query('SELECT id FROM '+table+' WHERE id=$1 AND user_id=$2',[id,user.id]);
  if(!owned.rowCount){send(res,404,{error:'Project not found'});return true;}
  if(req.method==='POST')await pool.query('INSERT INTO v2_public_projects(user_id,kind,project_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[user.id,kind,id]);
  else await pool.query('DELETE FROM v2_public_projects WHERE user_id=$1 AND kind=$2 AND project_id=$3',[user.id,kind,id]);
  send(res,200,{ok:true,published:req.method==='POST'});return true;
 }
 if(parts.length===6&&parts[2]==='save'&&/^\d+$/.test(parts[3])&&['beat','pack'].includes(parts[4])&&uuid.test(parts[5])&&['POST','DELETE'].includes(req.method)){
  const [, , ,owner,kind,id]=parts;
  const published=await pool.query('SELECT 1 FROM v2_public_projects WHERE user_id=$1 AND kind=$2 AND project_id=$3',[owner,kind,id]);
  if(req.method==='POST'&&!published.rowCount){send(res,404,{error:'Public project not found'});return true;}
  if(req.method==='POST')await pool.query('INSERT INTO v2_public_saves(user_id,owner_id,kind,project_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[user.id,owner,kind,id]);
  else await pool.query('DELETE FROM v2_public_saves WHERE user_id=$1 AND owner_id=$2 AND kind=$3 AND project_id=$4',[user.id,owner,kind,id]);
  send(res,200,{ok:true,saved:req.method==='POST'});return true;
 }
 send(res,404,{error:'Not found'});return true;
}
