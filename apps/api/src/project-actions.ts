// 1CE v2 project metadata and pack membership actions.
// Existing projects and private R2 file references are never cloned or deleted.
// All writes are owner-scoped and transactional where multiple rows change.
import {randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {ProjectKindV2,QueryableV2} from '../../../packages/shared/contracts.js';
import {moveProjectToTrash} from './trash.js';

type TxClientV2=QueryableV2&{release():void};
type TxPoolV2=QueryableV2&{connect():Promise<TxClientV2>};
type AccountV2={id:number};
type CurrentUserV2=(req:IncomingMessage)=>Promise<AccountV2|null>;
type ActionResultV2={status:number;data:unknown};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256=/^[a-f0-9]{64}$/;
const send=(res:ServerResponse,status:number,payload:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload));};
async function parseJson(req:IncomingMessage):Promise<Record<string,unknown>|null>{
 let raw='';for await(const part of req){raw+=part;if(raw.length>8192)throw Error('oversized');}
 try{return JSON.parse(raw) as Record<string,unknown>|null;}catch{throw Error('invalid');}
}
async function transaction(pool:TxPoolV2,owner:number,work:(db:TxClientV2)=>Promise<ActionResultV2>):Promise<ActionResultV2>{
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock($1::bigint)',[owner]);
  const result=await work(c);
  if(result.status>=400){await c.query('ROLLBACK');return result;}
  await c.query('COMMIT');return result;
 }catch(error){try{await c.query('ROLLBACK');}catch{}throw error;}
 finally{c.release();}
}
const result=(status:number,data:unknown):ActionResultV2=>({status,data});
async function readStemsBinding(db:QueryableV2,owner:number,beatId:string,lock=false){
 const row=(await db.query(`SELECT b.id,b.audio_file_id,a.sha256 AS audio_sha256,b.stems_file_id,
  s.sha256 AS stems_sha256 FROM library_beats b
  JOIN library_files a ON a.id=b.audio_file_id AND a.user_id=b.user_id AND a.kind='audio' AND a.status='ready'
  LEFT JOIN library_files s ON s.id=b.stems_file_id AND s.user_id=b.user_id AND s.kind='stems' AND s.status='ready'
  WHERE b.id=$1 AND b.user_id=$2 AND b.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM v2_public_projects p WHERE p.user_id=b.user_id AND p.kind='beat' AND p.project_id=b.id)
  ${lock?'FOR UPDATE OF b':''}`,[beatId,owner])).rows[0];
 if(!row)return null;
 return {beatId:row.id,audioFileId:String(row.audio_file_id),audioSha256:row.audio_sha256,
  stemsFileId:row.stems_file_id==null?null:String(row.stems_file_id),stemsSha256:row.stems_sha256};
}

async function attachStemsBinding(pool:TxPoolV2,owner:number,beatId:string,body:Record<string,unknown>|null|undefined){
 const {audioFileId,audioSha256,stemsFileId,stemsSha256}=body||{};
 const validId=(id:unknown):id is string=>typeof id==='string'&&/^[1-9]\d{0,15}$/.test(id)&&Number.isSafeInteger(Number(id));
 if(!validId(audioFileId)||!validId(stemsFileId)||
  typeof audioSha256!=='string'||!sha256.test(audioSha256)||typeof stemsSha256!=='string'||!sha256.test(stemsSha256))
  return result(400,{error:'Provide the expected audio and stems file IDs and SHA-256 values'});
 return transaction(pool,owner,async db=>{
  const current=await readStemsBinding(db,owner,beatId,true);
  if(!current)return result(404,{error:'Private beat not found'});
  if(current.audioFileId!==audioFileId||current.audioSha256!==audioSha256)
   return result(409,{error:'Beat audio no longer matches the approved binding'});
  if(current.stemsFileId!==null){
   if(current.stemsFileId===stemsFileId&&current.stemsSha256===stemsSha256)
    return result(200,{...current,reused:true});
   return result(409,{error:'This beat already has stems; existing stems were kept'});
  }
  const zip=await db.query("SELECT id FROM library_files WHERE id=$1 AND user_id=$2 AND kind='stems' AND status='ready' AND sha256=$3",
   [stemsFileId,owner,stemsSha256]);
  if(zip.rowCount!==1)return result(400,{error:'Stems must be a ready ZIP owned by you with the approved SHA-256'});
  const update=await db.query('UPDATE library_beats SET stems_file_id=$1 WHERE id=$2 AND user_id=$3 AND stems_file_id IS NULL RETURNING id',
   [stemsFileId,beatId,owner]);
  if(update.rowCount!==1)return result(409,{error:'The beat binding changed; recheck before retrying'});
  return result(200,{...current,stemsFileId,stemsSha256,reused:false});
 });
}
async function ownerProject(c:QueryableV2,kind:ProjectKindV2,id:string,owner:number):Promise<Record<string,unknown>|null>{
 const table=kind==='beat'?'library_beats':'library_packs';
 return (await c.query('SELECT id,title,cover_file_id FROM '+table+' WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE',[id,owner])).rows[0]||null;
}
async function sourceBeats(c:QueryableV2,kind:ProjectKindV2,id:string,owner:number):Promise<string[]>{
 if(kind==='beat'){
  const r=await c.query('SELECT id FROM library_beats WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL',[id,owner]);
  return r.rows.map(x=>x.id as string);
 }
 const r=await c.query(`SELECT b.id FROM library_packs p JOIN library_pack_beats pb ON pb.pack_id=p.id
  JOIN library_beats b ON b.id=pb.beat_id AND b.user_id=$2
  WHERE p.id=$1 AND p.user_id=$2 AND p.deleted_at IS NULL AND b.deleted_at IS NULL ORDER BY pb.position ASC`,[id,owner]);
 return r.rows.map(x=>x.id as string);
}
async function attach(c:QueryableV2,targetId:string,beatIds:string[]):Promise<number>{
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
export async function handleProjectActions(req:IncomingMessage,res:ServerResponse,pathname:string,pool:TxPoolV2,currentUser:CurrentUserV2):Promise<boolean>{
 if(!pathname.startsWith('/api/library/projects/'))return false;
 const binding=pathname.match(/^\/api\/library\/projects\/beat\/([^/]+)\/stems-binding$/);
 if(binding ? !['GET','POST'].includes(req.method||'') : !['PATCH','DELETE','POST'].includes(req.method||'')){
  send(res,405,{error:'Method not allowed'});return true;
 }
 const user=await currentUser(req);
 if(!user){send(res,401,{error:'Not authenticated'});return true;}
 const parts=pathname.split('/').filter(Boolean);
 const owner=Number(user.id);
 if(binding){
  const beatId=binding[1];
  if(!uuid.test(beatId)){send(res,404,{error:'Private beat not found'});return true;}
  if(req.method==='GET'){
   const current=await readStemsBinding(pool,owner,beatId);
   send(res,current?200:404,current??{error:'Private beat not found'});return true;
  }
  if(req.headers['content-type']?.split(';')[0]!=='application/json'){
   send(res,415,{error:'Expected application/json'});return true;
  }
  let body:Record<string,unknown>|null;
  try{body=await parseJson(req);}catch{send(res,400,{error:'Invalid JSON request'});return true;}
  const response=await attachStemsBinding(pool,owner,beatId,body);
  send(res,response.status,response.data);return true;
 }
 let body:Record<string,unknown>|null|undefined;
 if(req.method!=='DELETE'){
  try{body=await parseJson(req);}catch{send(res,400,{error:'Invalid JSON request'});return true;}
 }
 // POST /api/library/projects/packs/from  {sourceKind,sourceId,title}
 if(req.method==='POST'&&parts.length===5&&parts[3]==='packs'&&parts[4]==='from'){
  const {sourceKind,sourceId}=body||{};
  const title=typeof body?.title==='string'?body.title.trim():'';
  if(!['beat','pack'].includes(sourceKind as string)||!uuid.test((sourceId||'') as string)||!title||title.length>180){
   send(res,400,{error:'Invalid new project'});return true;
  }
  const response=await transaction(pool,owner,async c=>{
   const beats=await sourceBeats(c,sourceKind as ProjectKindV2,sourceId as string,owner);
   if(!beats.length)return result(404,{error:'Source project is unavailable or empty'});
   if(beats.length>100)return result(400,{error:'A pack cannot contain more than 100 beats'});
   const id=randomUUID();
   await c.query('INSERT INTO library_packs(id,user_id,title,cover_file_id) VALUES($1,$2,$3,NULL)',[id,owner,title]);
   await attach(c,id,beats);
   return result(201,{id,title,track_count:beats.length});
  });
  send(res,response.status,response.data);return true;
 }
 // POST /api/library/projects/pack/:targetId/audio {audioFileId,title}
 // One owner-scoped transaction prevents orphan standalone beats if attachment fails.
 if(req.method==='POST'&&parts.length===6&&parts[3]==='pack'&&uuid.test(parts[4])&&parts[5]==='audio'){
  const audioId=body?.audioFileId;
  const title=typeof body?.title==='string'?body.title.trim():'';
  if(typeof audioId!=='number'||!Number.isSafeInteger(audioId)||audioId<1||!title||title.length>180){
   send(res,400,{error:'Invalid audio or title'});return true;
  }
  const response=await transaction(pool,owner,async c=>{
   if(!await ownerProject(c,'pack',parts[4],owner))return result(404,{error:'Target pack not found'});
   const file=await c.query("SELECT id FROM library_files WHERE id=$1 AND user_id=$2 AND kind='audio' AND status='ready'",[audioId,owner]);
   if(file.rowCount!==1)return result(400,{error:'Audio must be owned by you and ready'});
   const found=(await c.query('SELECT id,deleted_at FROM library_beats WHERE user_id=$1 AND audio_file_id=$2',[owner,audioId])).rows[0];
   if(found?.deleted_at)return result(409,{error:'Beat is in Trash. Restore it first.'});
   const existing=(await c.query('SELECT beat_id FROM library_pack_beats WHERE pack_id=$1',[parts[4]])).rows.map(row=>String(row.beat_id));
   if(existing.length>=100&&(!found||!existing.includes(String(found.id))))
    return result(400,{error:'A pack cannot contain more than 100 beats'});
   const beatId=found?String(found.id):randomUUID();
   if(!found)await c.query('INSERT INTO library_beats(id,user_id,title,audio_file_id,library_visible) VALUES($1,$2,$3,$4,FALSE)',
    [beatId,owner,title,audioId]);
   const added=await attach(c,parts[4],[beatId]);
   return result(200,{id:parts[4],beatId,added,track_count:existing.length+added,reused:!!found});
  });
  send(res,response.status,response.data);return true;
 }
 // POST /api/library/projects/pack/:targetId/add {sourceKind,sourceId}
 if(req.method==='POST'&&parts.length===6&&parts[3]==='pack'&&uuid.test(parts[4])&&parts[5]==='add'){
  const {sourceKind,sourceId}=body||{};
  if(!['beat','pack'].includes(sourceKind as string)||!uuid.test((sourceId||'') as string)){
   send(res,400,{error:'Invalid source'});return true;
  }
  const response=await transaction(pool,owner,async c=>{
   if(!await ownerProject(c,'pack',parts[4],owner))return result(404,{error:'Target pack not found'});
   if(sourceKind==='pack'&&sourceId===parts[4])return result(400,{error:'Cannot add a pack to itself'});
   const beats=await sourceBeats(c,sourceKind as ProjectKindV2,sourceId as string,owner);
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
 const kind=parts[3] as ProjectKindV2,id=parts[4],table=kind==='beat'?'library_beats':'library_packs';
 if(req.method==='PATCH'){
  const hasTitle=Object.hasOwn(body||{},'title');
  const hasCover=Object.hasOwn(body||{},'coverFileId');
  const hasStems=Object.hasOwn(body||{},'stemsFileId');
  const title=hasTitle&&typeof body?.title==='string'?body.title.trim():null;
  const cover=body?.coverFileId as number|null;
  const stems=body?.stemsFileId as number|null;
  // Only a beat can reference stems. Each update modifies exactly one field.
  if(Number(hasTitle)+Number(hasCover)+Number(hasStems)!==1||
   (hasTitle&&(!title||title.length>180))||
   (hasCover&&cover!==null&&(!Number.isSafeInteger(cover)||cover<1))||
   (hasStems&&(kind!=='beat'||(stems!==null&&(!Number.isSafeInteger(stems)||stems<1))))){
   send(res,400,{error:'Specify one valid title, coverFileId or beat stemsFileId'});return true;
  }
  const response=await transaction(pool,owner,async c=>{
   if(!await ownerProject(c,kind,id,owner))return result(404,{error:'Project not found'});
   if(hasCover&&cover!==null){
    const check=await c.query("SELECT id FROM library_files WHERE id=$1 AND user_id=$2 AND kind='cover' AND status='ready'",[cover,owner]);
    if(!check.rowCount)return result(400,{error:'Cover must be a ready image owned by you'});
   }
   if(hasStems&&stems!==null){
    const check=await c.query("SELECT id FROM library_files WHERE id=$1 AND user_id=$2 AND kind='stems' AND status='ready'",[stems,owner]);
    if(!check.rowCount)return result(400,{error:'Stems must be a ready ZIP owned by you'});
   }
   const field=hasTitle?'title':hasCover?'cover_file_id':'stems_file_id';
   const value=hasTitle?title:hasCover?cover:stems;
   const returning=kind==='beat'?'id,title,cover_file_id,stems_file_id':'id,title,cover_file_id';
   const changed=await c.query('UPDATE '+table+' SET '+field+'=$1 WHERE id=$2 AND user_id=$3 RETURNING '+returning,[value,id,owner]);
   return result(200,{project:changed.rows[0],kind});
  });
  send(res,response.status,response.data);return true;
 }
 if(req.method==='DELETE'){
  const response=await transaction(pool,owner,async c=>{
   const moved=await moveProjectToTrash(c,{owner,kind,id});
   return moved?result(200,{trashed:true,id,kind,restoreDays:30}):result(404,{error:'Project not found'});
  });
  send(res,response.status,response.data);return true;
 }
 send(res,405,{error:'Method not allowed'});return true;
}
