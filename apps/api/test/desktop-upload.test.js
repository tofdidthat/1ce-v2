import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import test from 'node:test';
import pg from 'pg';
import {desktopUploadUser,handleDesktopUploadAuth} from '../dist/desktop-upload-auth.js';
import {handleLibraryFiles} from '../dist/library-files.js';

const dbUrl=process.env.T063_LOCAL_TEST_DB;
const origin='http://localhost:5173';
const digest=value=>createHash('sha256').update(value).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
const verifier=random();
const codeChallenge=createHash('sha256').update(verifier).digest('base64url');

test('desktop upload grants and retries are scoped to the authorizing account', {skip:!dbUrl}, async()=>{
 const url=new URL(dbUrl);
 assert.equal(url.hostname,'127.0.0.1');
 assert.ok(['/t063_test','/onece_s2_ci'].includes(url.pathname));
 const schema='t063_'+randomBytes(8).toString('hex');
 const admin=new pg.Pool({connectionString:dbUrl});
 const pool=new pg.Pool({connectionString:dbUrl,options:'-c search_path='+schema});

 try{
  await admin.query('CREATE SCHEMA '+schema);
  for(const file of ['001_auth_initial_schema','003_library_files_r2','004_library_collections',
   '004_public_profiles','005_library_asset_dedup','010_api_rate_limits','011_storage_plans_completion_leases',
   '012_trash_and_r2_delete_outbox','025_desktop_upload_grants']){
   await pool.query(await readFile(new URL('../../../history/database/'+file+'.sql',import.meta.url),'utf8'));
  }
  const {rows:[alice,bob]}=await pool.query(
   "INSERT INTO account_users(email) VALUES('alice@example.test'),('bob@example.test') RETURNING id");
  const webBetaMigration=await readFile(new URL('../../../history/database/026_web_beta_accounts.sql',import.meta.url),'utf8');
  await pool.query(webBetaMigration);
  await pool.query(webBetaMigration);
  const existing=(await pool.query('SELECT web_beta FROM account_users ORDER BY id')).rows;
  assert.deepEqual(existing,[{web_beta:false},{web_beta:false}]);
  const aliceSession=digest(random());
  const bobSession=digest(random());
  await pool.query("INSERT INTO account_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour'),($3,$4,now()+interval '1 hour')",
   [alice.id,aliceSession,bob.id,bobSession]);

  const objects=new Map();
  const storageFactory=()=>({bucket:'test',s3:{async send(command){
   const {Key,CopySource}=command.input;
   switch(command.constructor.name){
    case 'HeadObjectCommand':return {ContentLength:objects.get(Key).length,ContentType:'audio/mpeg',ETag:'test-etag'};
    case 'GetObjectCommand':{
     const object=objects.get(Key);
     const range=command.input.Range;
     if(!range)return {Body:Readable.from([object]),ContentLength:object.length};
     const [,start,end]=/^bytes=(\d+)-(\d+)$/.exec(range);
     const bytes=object.subarray(Number(start),Number(end)+1);
     return {Body:Readable.from([bytes]),ContentLength:bytes.length,ContentRange:`bytes ${start}-${end}/${object.length}`};
    }
    case 'CopyObjectCommand':objects.set(Key,objects.get(decodeURIComponent(CopySource).slice('test/'.length)));return {};
    case 'DeleteObjectCommand':objects.delete(Key);return {};
    default:throw Error('Unexpected test storage operation');
   }
  }}});
  const signUrl=async(_client,command)=>command.input.Key;
  const desktopUser=req=>desktopUploadUser(req,pool);
  async function request(path,{data,token,session,source,method='POST'}={}){
   let result;
   const req=Readable.from(data?[JSON.stringify(data)]:[]);
   req.method=method;
   req.headers={'content-type':'application/json',origin:source,authorization:token&&'Bearer '+token};
   const res={writeHead(status){result={status};},end(body){result.data=JSON.parse(body);}};
   if(!await handleDesktopUploadAuth(req,res,path,pool,origin,session)){
    await handleLibraryFiles(req,res,path,pool,async()=>null,{desktopUser,storageFactory,signUrl});
   }
   return result;
  }
  const authorize=(id,session,source=origin)=>request('/auth/desktop-upload/authorize',{data:{codeChallenge,accountId:id},session,source});
  const exchange=(code,codeVerifier=verifier)=>request('/auth/desktop-upload/token',{data:{code,codeVerifier}});

  assert.equal((await authorize(alice.id,aliceSession,'https://example.test')).status,403);
  assert.equal((await authorize(alice.id)).status,401);
  assert.equal((await authorize(alice.id,bobSession)).status,409);
  const authorization=await authorize(alice.id,aliceSession);
  assert.equal(authorization.status,200);
  const {code}=authorization.data;
  assert.equal((await exchange(code,random())).status,401);
  const attempts=await Promise.all([exchange(code),exchange(code)]);
  assert.deepEqual(attempts.map(x=>x.status).sort(),[200,401]);
  const {accountId,accessToken:token,expiresIn}=attempts.find(x=>x.status===200).data;
  assert.equal(accountId,alice.id);
  assert.equal(expiresIn,1800);
  const expired=(await authorize(alice.id,aliceSession)).data.code;
  await pool.query("UPDATE account_desktop_upload_grants SET code_expires_at=now()-interval '1 second' WHERE code_hash=$1",[digest(expired)]);
  assert.equal((await exchange(expired)).status,401);
  const bobToken=(await exchange((await authorize(bob.id,bobSession)).data.code)).data.accessToken;
  const pendingCode=(await authorize(bob.id,bobSession)).data.code;
  await pool.query('UPDATE account_users SET web_beta = true WHERE id = $1',[bob.id]);
  assert.equal((await authorize(bob.id,bobSession)).status,403);
  assert.equal((await exchange(pendingCode)).status,401);
  assert.equal(await desktopUploadUser({headers:{authorization:'Bearer '+bobToken}},pool),null);
  await pool.query('UPDATE account_users SET web_beta = false WHERE id = $1',[bob.id]);

  const base='/api/library/files';
  const frame=Buffer.alloc(417);
  Buffer.from([0xff,0xfb,0x90,0x64]).copy(frame);
  const audio=Buffer.concat([frame,frame]);
  const data={kind:'audio',name:'sample.mp3',contentType:'audio/mpeg',size:audio.length,sha256:digest(audio)};
  assert.equal((await request(base+'/packs',{token,data:{}})).status,401);
  assert.equal((await request(base+'/init',{token,data,source:origin})).status,401);
  const [first,retry]=await Promise.all([request(base+'/init',{token,data}),request(base+'/init',{token,data})]);
  assert.equal(first.status,200);
  assert.deepEqual(retry,first);
  const {id,uploadUrl}=first.data;
  const complete=base+'/'+id+'/complete';
  assert.equal((await request(complete,{token:bobToken})).status,404);
  objects.set(uploadUrl,audio);
   const completed=await request(complete,{token});
  assert.equal(completed.status,200,JSON.stringify(completed.data));
  assert.equal((await request(complete,{token})).status,200);
  assert.deepEqual((await request(base+'/init',{token,data})).data,{id,reused:true});

  const stems=await pool.query(`INSERT INTO library_files(user_id,kind,object_key,original_name,content_type,byte_size,status)
   VALUES($1,'stems','fixture/stems.zip','stems.zip','application/zip',1,'ready') RETURNING id`,[alice.id]);
  const beat={title:'Test beat',audioFileId:Number(id),stemsFileId:Number(stems.rows[0].id)};
  assert.equal((await request(base+'/beats',{token:bobToken,data:beat})).status,400);
  const beats=await Promise.all([request(base+'/beats',{token,data:beat}),request(base+'/beats',{token,data:beat})]);
  assert.deepEqual(beats.map(x=>x.status).sort(),[200,201]);
  assert.equal(beats[0].data.id,beats[1].data.id);
  assert.equal((await request(base+'/beats',{token,data:{...beat,stemsFileId:null}})).status,409);
  const stored=await pool.query('SELECT stems_file_id FROM library_beats WHERE id=$1',[beats[0].data.id]);
  assert.equal(stored.rows[0].stems_file_id,stems.rows[0].id);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM v2_public_projects')).rows[0].n,0);
  assert.equal((await request('/auth/desktop-upload/revoke',{token})).status,200);
  assert.equal((await request(complete,{token})).status,401);
  await pool.query('DELETE FROM account_sessions WHERE token_hash=$1',[bobSession]);
  assert.equal((await request(base+'/init',{token:bobToken,data})).status,401);
 }finally{
  await pool.end();
  try{await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');}finally{await admin.end();}
 }
});
