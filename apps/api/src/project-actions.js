// 1CE v2 project metadata and pack membership actions.
// Existing projects and private R2 file references are never cloned or deleted.
// All writes are owner-scoped and transactional where multiple rows change.
import {randomUUID} from 'node:crypto';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const send=(res,status,payload)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload));};
async function parseJson(req){
 let raw='';for await(const part of req){raw+=part;if(raw.length>8192)throw Error('oversized');}
 try{return JSON.parse(raw);}catch{throw Error('invalid');}
}
async function transaction(pool,work){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const result=await work(c);
  if(result.status>=400){await c.query('ROLLBACK');return result;}
  await c.query('COMMIT');return result;
 }catch(error){try{await c.query('ROLLBACK');}catch{}throw error;}
 finally{c.release();}
}
const result=(status,data)=>({status,data});
async function ownerProject(c,kind,id,owner){
 const table=kind==='beat'?'library_beats':'library_packs';
 return (await c.query('SELECT id,title,cover_file_id FROM '+table+' WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,owner])).rows[0]||null;
}
async function sourceBeats(c,kind,id,owner){
 if(kind==='beat'){
  const r=await c.query('SELECT id FROM library_beats WHERE id=$1 AND user_id=$2',[id,owner]);
  return r.rows.map(x=>x.id);
 }
 const r=await c.query(`SELECT b.id FROM library_packs p JOIN library_pack_beats pb ON pb.pack_id=p.id
  JOIN library_beats b ON b.id=pb.beat_id AND b.user_id=$2
  WHERE p.id=$1 AND p.user_id=$2 ORDER BY pb.position ASC`,[id,owner]);
 return r.rows.map(x=>x.id);
}
async function attach(c,targetId,beatIds){
 const rows=await c.query('SELECT beat_id,position FROM library_pack_beats WHERE pack_id=$1 ORDER BY position ASC',[targetId]);
 const existing=new Set(rows.rows.map(x=>String(x.beat_id)));
 let next=Math.max(-1,...rows.rows.map(x=>Number(x.position)))+1,added=0;
 for(const id of beatIds){
  if(existing.has(String(id)))continue;
  await c.query('INSERT INTO library_pack_beats(pack_id,beat_id,position) VALUES($1,$2,$3)',[targetId,id,next++]);
  existing.add(String(id));added++;
 }
 return added;
}
export async function handleProjectActions(req,res,pathname,pool,currentUser){
 if(!pathname.startsWith('/api/library/projects/'))return false;
 if(!['PATCH','DELETE','POST'].includes(req.method)){send(res,405,{error:'Method not allowed'});return true;}
 const user=await currentUser(req);
 if(!user){send(res,401,{error:'Not authenticated'});return true;}
 const parts=pathname.split('/').filter(Boolean);
 const owner=Number(user.id);
 let body;
 if(req.method!=='DELETE'){
  try{body=await parseJson(req);}catch{send(res,400,{error:'Invalid JSON request'});return true;}
 }
 // POST /api/library/projects/packs/from  {sourceKind,sourceId,title}
 if(req.method==='POST'&&parts.length===5&&parts[3]==='packs'&&parts[4]==='from'){
  const {sourceKind,sourceId}=body||{};
  const title=typeof body?.title==='string'?body.title.trim():'';
  if(!['beat','pack'].includes(sourceKind)||!uuid.test(sourceId||'')||!title||title.length>180){
   send(res,400,{error:'Invalid new project'});return true;
  }
  const response=await transaction(pool,async c=>{
   const beats=await sourceBeats(c,sourceKind,sourceId,owner);
   if(!beats.length)return result(404,{error:'Source project is unavailable or empty'});
   if(beats.length>100)return result(400,{error:'A pack cannot contain more than 100 beats'});
   const id=randomUUID();
   await c.query('INSERT INTO library_packs(id,user_id,title,cover_file_id) VALUES($1,$2,$3,NULL)',[id,owner,title]);
   await attach(c,id,beats);
   return result(201,{id,title,track_count:beats.length});
  });
  send(res,response.status,response.data);return true;
 }
 // POST /api/library/projects/pack/:targetId/add {sourceKind,sourceId}
 if(req.method==='POST'&&parts.length===6&&parts[3]==='pack'&&uuid.test(parts[4])&&parts[5]==='add'){
  const {sourceKind,sourceId}=body||{};
  if(!['beat','pack'].includes(sourceKind)||!uuid.test(sourceId||'')){
   send(res,400,{error:'Invalid source'});return true;
  }
  const response=await transaction(pool,async c=>{
   if(!await ownerProject(c,'pack',parts[4],owner))return result(404,{error:'Target pack not found'});
   if(sourceKind==='pack'&&sourceId===parts[4])return result(400,{error:'Cannot add a pack to itself'});
   const beats=await sourceBeats(c,sourceKind,sourceId,owner);
   if(!beats.length)return result(404,{error:'Source project is unavailable or empty'});
   const members=await c.query('SELECT beat_id FROM library_pack_beats WHERE pack_id=$1',[parts[4]]);
   const unique=new Set([...members.rows.map(x=>String(x.beat_id)),...beats.map(String)]);
   if(unique.size>100)return result(400,{error:'A pack cannot contain more than 100 beats'});
   const added=await attach(c,parts[4],beats);
   return result(200,{id:parts[4],added,track_count:unique.size});
  });
  send(res,response.status,response.data);return true;
 }
 // PATCH/DELETE /api/library/projects/:kind/:projectId
 if(parts.length!==5||!['beat','pack'].includes(parts[3])||!uuid.test(parts[4])){
  send(res,404,{error:'Not found'});return true;
 }
 const kind=parts[3],id=parts[4],table=kind==='beat'?'library_beats':'library_packs';
 if(req.method==='PATCH'){
  const hasTitle=Object.hasOwn(body||{},'title');
  const hasCover=Object.hasOwn(body||{},'coverFileId');
  const title=hasTitle&&typeof body.title==='string'?body.title.trim():null;
  const cover=body?.coverFileId;
  if(hasTitle===hasCover||(hasTitle&&(!title||title.length>180))||
   (hasCover&&cover!==null&&(!Number.isSafeInteger(cover)||cover<1))){
   send(res,400,{error:'Specify one valid title or coverFileId'});return true;
  }
  const response=await transaction(pool,async c=>{
   if(!await ownerProject(c,kind,id,owner))return result(404,{error:'Project not found'});
   if(hasCover&&cover!==null){
    const check=await c.query("SELECT id FROM library_files WHERE id=$1 AND user_id=$2 AND kind='cover' AND status='ready'",[cover,owner]);
    if(!check.rowCount)return result(400,{error:'Cover must be a ready image owned by you'});
   }
   const field=hasTitle?'title':'cover_file_id';
   const value=hasTitle?title:cover;
   const changed=await c.query('UPDATE '+table+' SET '+field+'=$1 WHERE id=$2 AND user_id=$3 RETURNING id,title,cover_file_id',[value,id,owner]);
   return result(200,{project:changed.rows[0],kind});
  });
  send(res,response.status,response.data);return true;
 }
 if(req.method==='DELETE'){
  const response=await transaction(pool,async c=>{
   if(!await ownerProject(c,kind,id,owner))return result(404,{error:'Project not found'});
   // These generic UUID relationships intentionally have no FK to beats/packs.
   // Remove them before deleting metadata so no stale public/granted/save edges survive.
   await c.query('DELETE FROM v2_public_projects WHERE user_id=$1 AND kind=$2 AND project_id=$3',[owner,kind,id]);
   await c.query('DELETE FROM v2_public_saves WHERE owner_id=$1 AND kind=$2 AND project_id=$3',[owner,kind,id]);
   await c.query('DELETE FROM v2_project_access WHERE owner_id=$1 AND kind=$2 AND project_id=$3',[owner,kind,id]);
   await c.query('DELETE FROM v2_project_share_links WHERE owner_id=$1 AND kind=$2 AND project_id=$3',[owner,kind,id]);
   if(kind==='beat'){
    // Pack member rows reference beats with ON DELETE RESTRICT.
    // Explicitly detach only this beat, retaining all other pack beats.
    await c.query('DELETE FROM library_pack_beats WHERE beat_id=$1',[id]);
   }
   // Pack member rows are ON DELETE CASCADE. Neither deletion deletes R2.
   await c.query('DELETE FROM '+table+' WHERE id=$1 AND user_id=$2',[id,owner]);
   return result(200,{deleted:true,id,kind,mediaRetained:true});
  });
  send(res,response.status,response.data);return true;
 }
 send(res,405,{error:'Method not allowed'});return true;
}
