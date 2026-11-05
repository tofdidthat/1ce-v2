// Phase 4C: exercise real PostgreSQL schema/transactions with compiled API.
// Only runs inside GitHub Actions against the existing disposable S2 CI DB.
// Fake signer/storage forbid accidental external R2 network calls.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import pg from 'pg';
import {handleLibraryFiles} from '../dist/library-files.js';
import {handleProjectActions} from '../dist/project-actions.js';

const connectionString=process.env.S2_TEST_DATABASE_URL;
const address=connectionString?new URL(connectionString):null;
if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||
 !address||!['postgres:','postgresql:'].includes(address.protocol)||
 !['localhost','127.0.0.1'].includes(address.hostname)||
 address.pathname!=='/onece_s2_ci'||address.port!=='5432')
 throw Error('Refusing non-disposable PostgreSQL library integration run');
const db=new pg.Pool({connectionString,max:12,connectionTimeoutMillis:5000});
const signed=[];
const storage={
 async send(){throw Error('Real R2 call forbidden in PostgreSQL-only test');}
};
const opts={
 storageFactory:()=>({s3:storage,bucket:'never-production'}),
 signUrl:async(_s3,command,options)=>{
  signed.push({key:command.input.Key,expiresIn:options.expiresIn});
  return 'https://local-signature.invalid/ci-only';
 }
};
const sha=value=>createHash('sha256').update(String(value)).digest('hex');
async function invoke(route,data,userId){
 const req=Readable.from([Buffer.from(JSON.stringify(data))]);req.method='POST';req.headers={};
 const res={status:0,body:null,writeHead(s){this.status=s;},end(raw){this.body=raw?JSON.parse(raw):null;}};
 assert.equal(await handleLibraryFiles(req,res,route,db,async()=>({id:userId}),opts),true);
 return res;
}
async function patchProject(path,data,userId){
 const req=Readable.from([Buffer.from(JSON.stringify(data))]);req.method='PATCH';req.headers={};
 const res={status:0,body:null,writeHead(status){this.status=status;},end(raw){this.body=raw?JSON.parse(raw):null;}};
 assert.equal(await handleProjectActions(req,res,'/api/library/projects/'+path,db,async()=>userId==null?null:{id:userId}),true);
 return res;
}
async function getFile(path,userId){
 const req=Readable.from([]);req.method='GET';req.headers={};
 const res={status:0,headers:{},body:null,writeHead(status,headers={}){this.status=status;this.headers=headers;},end(raw){this.body=raw?JSON.parse(raw):null;}};
 assert.equal(await handleLibraryFiles(req,res,'/api/library/files/'+path,db,async()=>userId==null?null:{id:userId},opts),true);
 return res;
}
async function ready(owner,kind,label,status='ready',bytes=800){
 const key='users/'+owner+'/assets/'+kind+'/verified/'+randomUUID();
 const content=kind==='audio'?'audio/mpeg':kind==='cover'?'image/png':'application/zip';
 const result=await db.query(
  `INSERT INTO library_files(user_id,kind,object_key,original_name,content_type,byte_size,status,sha256)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
  [owner,kind,key,label,content,bytes,status,sha(label)]);
 return Number(result.rows[0].id);
}
async function count(sql,args){return Number((await db.query(sql,args)).rows[0].n);}
try{
 const a=(await db.query("INSERT INTO account_users(email) VALUES('phase4c-owner-a@ci.invalid') RETURNING id")).rows[0].id;
 const b=(await db.query("INSERT INTO account_users(email) VALUES('phase4c-owner-b@ci.invalid') RETURNING id")).rows[0].id;

 // Concurrent init: owner advisory lock serializes the ten allowed reservations.
 const attempts=await Promise.all(Array.from({length:11},(_,i)=>invoke('/api/library/files/init',{
  kind:'audio',name:'test-'+i+'.mp3',contentType:'audio/mpeg',size:1024,sha256:sha('ci-init-'+i)
 },a)));
 assert.equal(attempts.filter(x=>x.status===200).length,10);
 assert.equal(attempts.filter(x=>x.status===429).length,1);
 assert.equal(signed.length,10);
 for(const x of attempts.filter(x=>x.status===200)){
  const row=(await db.query('SELECT user_id,status,object_key FROM library_files WHERE id=$1',[x.body.id])).rows[0];
  assert.equal(row.user_id,a);
  assert.equal(row.status,'pending');
  assert.match(row.object_key,new RegExp('^staging/users/'+a+'/assets/audio/'));
  assert.equal(x.body.expiresIn,300);
 }
 assert.equal(await count("SELECT count(*)::int AS n FROM library_files WHERE user_id=$1 AND status='pending'",[a]),10);
 assert.equal((await invoke('/api/library/files/init',{
  kind:'audio',name:'another-owner.mp3',contentType:'audio/mpeg',size:1024,sha256:sha('other-account')
 },b)).status,200,'Other owner quotas must be independent');

 // Asset and beat references: only READY rows belonging to owner may be linked.
 const audioA=await ready(a,'audio','audio-a.mp3');
 const audioA2=await ready(a,'audio','audio-a2.mp3');
 const audioB=await ready(b,'audio','audio-b.mp3');
 const coverA=await ready(a,'cover','cover-a.png');
 const coverB=await ready(b,'cover','cover-b.png');
 const coverPending=await ready(a,'cover','cover-pending.png','pending');
 const stemsA=await ready(a,'stems','stems-a.zip');
 const beatEndpoint='/api/library/files/beats';
 for(const data of [
  {title:'Foreign audio',audioFileId:audioB},
  {title:'Foreign cover',audioFileId:audioA,coverFileId:coverB},
  {title:'Pending cover',audioFileId:audioA,coverFileId:coverPending}
 ]){
  const rejected=await invoke(beatEndpoint,data,a);
  assert.equal(rejected.status,400,JSON.stringify(rejected.body));
 }
 const beatOne=await invoke(beatEndpoint,{title:'Existing standalone',audioFileId:audioA,coverFileId:coverA,stemsFileId:stemsA},a);
 const beatTwo=await invoke(beatEndpoint,{title:'New pack track',audioFileId:audioA2},a);
 const beatOther=await invoke(beatEndpoint,{title:'Foreign track',audioFileId:audioB},b);
 assert.equal(beatOne.status,201);assert.equal(beatTwo.status,201);assert.equal(beatOther.status,201);
 const dedupe=await invoke(beatEndpoint,{title:'Duplicate',audioFileId:audioA},a);
 assert.equal(dedupe.status,200);assert.equal(dedupe.body.id,beatOne.body.id);
 assert.equal(dedupe.body.reused,true);
 assert.equal(await count('SELECT count(*)::int AS n FROM library_beats WHERE user_id=$1 AND audio_file_id=$2',[a,audioA]),1);

 // An account may not create a pack with a foreign beat or cover.
 const packEndpoint='/api/library/files/packs';
 const wrongBeat=await invoke(packEndpoint,{
  title:'Not allowed',beatIds:[beatOne.body.id,beatOther.body.id]
 },a);
 assert.equal(wrongBeat.status,403);
 const wrongCover=await invoke(packEndpoint,{
  title:'Not allowed',beatIds:[beatOne.body.id,beatTwo.body.id],coverFileId:coverB
 },a);
 assert.equal(wrongCover.status,403);
 const good=await invoke(packEndpoint,{
  title:'Owner only',beatIds:[beatOne.body.id,beatTwo.body.id],
  newBeatIds:[beatTwo.body.id],coverFileId:coverA
 },a);
 assert.equal(good.status,201,JSON.stringify(good.body));
 const linked=await db.query('SELECT beat_id,position FROM library_pack_beats WHERE pack_id=$1 ORDER BY position',[good.body.id]);
 assert.deepEqual(linked.rows.map(x=>x.beat_id),[beatOne.body.id,beatTwo.body.id]);
 const flags=await db.query('SELECT id,library_visible FROM library_beats WHERE id=ANY($1::uuid[])',[[beatOne.body.id,beatTwo.body.id]]);
 const visible=new Map(flags.rows.map(x=>[x.id,x.library_visible]));
 assert.equal(visible.get(beatOne.body.id),true);
 assert.equal(visible.get(beatTwo.body.id),false);
 assert.equal(await count('SELECT count(*)::int AS n FROM library_packs WHERE user_id=$1',[a]),1);

 // Owner-scoped read contracts: real PostgreSQL, no real S3 requests.
 // These must stay stable when GET dispatch is extracted in a future PR.
 const [homeA,homeB,homeAnonymous]=await Promise.all([
  getFile('items',a),getFile('items',b),getFile('items',null)
 ]);
 assert.equal(homeA.status,200);
 assert.equal(homeB.status,200);
 assert.equal(homeAnonymous.status,401);
 assert.equal(homeA.headers['Cache-Control'],'no-store');
 assert.equal(homeB.headers['Cache-Control'],'no-store');
 assert.deepEqual(homeAnonymous.body,{error:'Not authenticated'});
 assert.deepEqual(homeA.body.beats.map(row=>row.id).sort(),[beatOne.body.id,beatTwo.body.id].sort());
 assert.deepEqual(homeB.body.beats.map(row=>row.id),[beatOther.body.id]);
 assert.deepEqual(homeA.body.packs.map(row=>row.id),[good.body.id]);
 assert.deepEqual(homeB.body.packs,[],'Foreign packs must not appear in another Home');
 assert.equal(homeA.body.beats.find(row=>row.id===beatOne.body.id).library_visible,true);
 assert.equal(homeA.body.beats.find(row=>row.id===beatTwo.body.id).library_visible,false);
 const tracksA=await getFile('pack-tracks/'+good.body.id,a);
 const tracksB=await getFile('pack-tracks/'+good.body.id,b);
 assert.equal(tracksA.status,200);assert.equal(tracksB.status,200);
 assert.deepEqual(tracksA.body.beats.map(row=>row.id),[beatOne.body.id,beatTwo.body.id],
  'Pack membership and original order must remain unchanged');
 assert.deepEqual(tracksB.body,{beats:[]},'Unowned pack ID is indistinguishable from an empty pack under the current GET contract');
 assert.equal((await getFile('pack-tracks/'+good.body.id,null)).status,401);
 const filesA=await getFile('',a);
 const filesB=await getFile('',b);
 assert.equal(filesA.status,200);assert.equal(filesB.status,200);
 assert.ok(filesA.body.files.length>0);
 assert.ok(filesA.body.files.every(row=>!('object_key' in row)), 'Never expose R2 object keys');
 assert.ok(filesA.body.files.every(row=>row.id!==String(audioB)&&row.id!==audioB),'Foreign file IDs must not appear in Home');
 assert.ok(filesB.body.files.every(row=>row.id!==String(audioA)&&row.id!==audioA),'Owner A files cannot appear for B');
 assert.equal(filesA.body.files.some(row=>row.id===String(audioA)||row.id===audioA),true);
 assert.equal(filesA.body.files.some(row=>row.id===String(coverPending)||row.id===coverPending),false,
  'Pending files must not appear in READY listing');
 assert.equal((await getFile('',null)).status,401);
 assert.equal((await getFile('no-such-route',a)).status,404);

 // PR #57 real PostgreSQL authorization: attach/replace/unlink stems on the
 // canonical beat. Never write another beat, pack, library_file or R2 object.
 const stemsA2=await ready(a,'stems','stems-replacement.zip');
 const stemsB=await ready(b,'stems','foreign-stems.zip');
 const stemsPending=await ready(a,'stems','pending-stems.zip','pending');
 const path='beat/'+beatTwo.body.id;
 const meta=async userId=>getFile('beat/'+beatTwo.body.id,userId);
 assert.equal((await meta(a)).status,200);
 assert.equal((await meta(b)).status,404,'Foreign beat IDs must be private');
 assert.equal((await meta(null)).status,401,'Beat metadata must require login');
 assert.equal((await getFile('stems/'+stemsA,b)).status,404,'Foreign stems file must be private');
 assert.equal((await getFile('stems/'+stemsA,null)).status,401,'Stems file must require login');
 for(const forbidden of [
  {stemsFileId:stemsB},{stemsFileId:stemsPending},{stemsFileId:0},
  {stemsFileId:'42'},{stemsFileId:stemsA2,title:'invalid combined mutation'}
 ]){
  const refused=await patchProject(path,forbidden,a);
  assert.equal(refused.status,400,JSON.stringify({forbidden,response:refused.body}));
 }
 assert.equal((await patchProject('pack/'+good.body.id,{stemsFileId:stemsA2},a)).status,400);
 assert.equal((await patchProject(path,{stemsFileId:stemsA2},b)).status,404);
 assert.equal((await meta(a)).body.beat.stems_file_id,null,'Unauthorized PATCH must not change stems');
 const attached=await patchProject(path,{stemsFileId:stemsA2},a);
 assert.equal(attached.status,200,JSON.stringify(attached.body));
 assert.equal(Number((await meta(a)).body.beat.stems_file_id),stemsA2);
 const replacement=await patchProject(path,{stemsFileId:stemsA},a);
 assert.equal(replacement.status,200,JSON.stringify(replacement.body));
 assert.equal(Number((await meta(a)).body.beat.stems_file_id),stemsA);
 assert.equal((await patchProject(path,{stemsFileId:null},a)).status,200);
 assert.equal((await meta(a)).body.beat.stems_file_id,null,'Unlink must persist');
 assert.equal(Number((await meta(a)).body.beat.audio_file_id),audioA2,'Audio reference must remain unchanged');
 assert.equal(await count('SELECT count(*)::int AS n FROM library_files WHERE user_id=$1 AND kind=$2 AND status=$3',[a,'stems','ready']),2,
  'Unlink must not delete original R2 file rows');
 assert.equal(await count('SELECT count(*)::int AS n FROM library_pack_beats WHERE pack_id=$1',[good.body.id]),2,
  'Stems edits must not change pack membership');
 assert.equal(Number((await getFile('beat/'+beatOne.body.id,a)).body.beat.stems_file_id),stemsA,
  'Existing beat and pack shared stems reference must remain unchanged');

 // Ready-only dedup: reinit a ready stored SHA reuses owner file without URL.
 const existing=await invoke('/api/library/files/init',{
  kind:'audio',name:'ready.mp3',contentType:'audio/mpeg',size:800,sha256:sha('audio-a.mp3')
 },a);
 assert.equal(existing.status,200);
 assert.deepEqual(existing.body,{id:String(audioA),reused:true});
 assert.equal(signed.length,11,'Reused READY asset must never issue a signed PUT');
 console.log('Phase 4C + PR57 + API read contracts disposable PostgreSQL PASS: concurrent quota locks, READY dedup, per-owner grants, pack membership, stems owner-only attach/replace/unlink persistence, foreign and anonymous access denied; R2 intentionally not used');
}finally{await db.end();}
