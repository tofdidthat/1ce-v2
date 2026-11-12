// Runs after existing S2 schema setup, exclusively on disposable CI PostgreSQL.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {handleAudioWaveform,waveformSchema} from '../dist/audio-waveform.js';
const url=process.env.S2_TEST_DATABASE_URL?new URL(process.env.S2_TEST_DATABASE_URL):null;
if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||!url||
 !['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||
 url.port!=='5432'||url.pathname!=='/onece_s2_ci')throw Error('Disposable CI database required');
const db=new pg.Pool({connectionString:url.href,max:4});
const bars=Array.from({length:84},(_,i)=>i/84),hash='b'.repeat(64);
let owner,file,beat,decodes=0;
const decode=async()=>{decodes++;return bars};
async function get(viewer=owner,decoder=decode){
 const res={status:0,body:null,writeHead(s){this.status=s},end(raw){this.body=JSON.parse(raw)}};
 assert.equal(await handleAudioWaveform({method:'GET'},res,`/api/public/waveform/${owner}/${file}`,db,
  async()=>viewer===null?null:{id:viewer},{decode:decoder}),true);
 return res;
}
try{
 await db.query(waveformSchema);await db.query(waveformSchema);
 owner=(await db.query('INSERT INTO account_users(email) VALUES($1) RETURNING id',[`waveform-${randomUUID()}@ci.invalid`])).rows[0].id;
 file=String((await db.query(`INSERT INTO library_files(user_id,kind,object_key,original_name,content_type,byte_size,status,sha256)
  VALUES($1,'audio',$2,'synthetic.mp3','audio/mpeg',100,'ready',$3) RETURNING id`,
 [owner,`users/${owner}/assets/audio/verified/${randomUUID()}.mp3`,hash])).rows[0].id);
 beat=(await db.query('INSERT INTO library_beats(id,user_id,title,audio_file_id) VALUES($1,$2,$3,$4) RETURNING id',[randomUUID(),owner,'Synthetic waveform test',file])).rows[0].id;
 assert.equal((await get(null)).status,404);
 assert.equal((await get()).status,200);
 assert.equal((await get()).status,200);assert.equal(decodes,1,'Persistent bars reused');
 await db.query("INSERT INTO v2_public_projects(user_id,kind,project_id) VALUES($1,'beat',$2)",[owner,beat]);
 assert.equal((await get(null)).status,200);
 await db.query('DELETE FROM v2_public_projects WHERE user_id=$1 AND project_id=$2',[owner,beat]);
 assert.equal((await get(null)).status,404,'Persisted bars respect revoked publication');
 await db.query('UPDATE library_files SET sha256=$2 WHERE id=$1',[file,'c'.repeat(64)]);
 assert.equal((await get()).status,200);assert.equal(decodes,2,'Changed original version regenerates');
 await db.query('UPDATE v2_audio_waveforms SET bars=NULL,retry_after=clock_timestamp()-interval \'1 second\' WHERE file_id=$1',[file]);
 const stale=await get(owner,async()=>{
  await db.query('UPDATE v2_audio_waveforms SET lease_token=$2::uuid WHERE file_id=$1',[file,randomUUID()]);
  return bars;
 });
 assert.equal(stale.status,202,'Stolen lease cannot publish a result');
 assert.equal((await db.query('SELECT bars FROM v2_audio_waveforms WHERE file_id=$1',[file])).rows[0].bars,null);
 await db.query('UPDATE v2_audio_waveforms SET retry_after=clock_timestamp()-interval \'1 second\' WHERE file_id=$1',[file]);
 assert.equal((await get(owner,async()=>{throw Error('Controlled decoder failure')})).status,503);
 assert.equal((await get()).status,202,'Failed generation is cooled down');
 await db.query('UPDATE v2_audio_waveforms SET retry_after=clock_timestamp()-interval \'1 second\' WHERE file_id=$1',[file]);
 assert.equal((await get()).status,200,'Expired lease/failure recovers');
 await db.query('DELETE FROM library_beats WHERE id=$1',[beat]);
 await db.query('DELETE FROM library_files WHERE id=$1',[file]);
 assert.equal((await db.query('SELECT * FROM v2_audio_waveforms WHERE file_id=$1',[file])).rowCount,0,'File deletion cascades visual metadata');
 console.log('Waveform PostgreSQL PASS: persistence, authorization, version invalidation, fencing, cooldown, retry, cascade. No R2 requests.');
}finally{
 if(owner){
  await db.query('DELETE FROM v2_public_projects WHERE user_id=$1',[owner]);
  await db.query('DELETE FROM library_beats WHERE user_id=$1',[owner]);
  await db.query('DELETE FROM library_files WHERE user_id=$1',[owner]);
  await db.query('DELETE FROM account_users WHERE id=$1',[owner]);
 }
 await db.end();
}

