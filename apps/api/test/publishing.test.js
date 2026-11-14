import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {mkdtemp,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {deflateSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {sealPublishing,openPublishing} from '../dist/publishing-secrets.js';
import {beginYouTubeConnection,startYouTubeConnection,finishYouTubeConnection,youtubeAccess} from '../dist/youtube-connection.js';
import {parsePublicationInput} from '../dist/publishing-jobs.js';
import {handlePublishing} from '../dist/publishing-api.js';
import {publicationRendererAvailable,renderPublication,parseMediaDuration} from '../dist/publication-renderer.js';
const config={clientId:'fixture-client',clientSecret:'fixture-secret-not-a-real-credential',encryptionSecret:'fixture-encryption-not-a-real-secret',
 redirectUri:'https://api.invalid/auth/google/callback',webOrigin:'https://web.invalid'};
function response(){return {status:0,headers:{},body:'',writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=body||''}}}
test('credentials are encrypted and cannot be transplanted across accounts or purposes',()=>{
 const value=sealPublishing('fixture-refresh','youtube-refresh:1',config.encryptionSecret);
 assert.doesNotMatch(value,/fixture-refresh/);
 assert.equal(openPublishing(value,'youtube-refresh:1',config.encryptionSecret),'fixture-refresh');
 for(const context of ['youtube-refresh:2','youtube-session:1:10'])assert.throws(()=>openPublishing(value,context,config.encryptionSecret));
 assert.throws(()=>openPublishing(value,'youtube-refresh:1','different-fixture-master-key'));
});
test('OAuth connection uses offline scopes, PKCE, state hash and a separate secure cookie',async()=>{
 const calls=[];const db={async query(sql,args){calls.push({sql,args});return sql.startsWith('UPDATE')?
  {rowCount:1,rows:[{verifier_cipher:sealPublishing('fixture-pkce','youtube-state:7',config.encryptionSecret)}]}:{rows:[]}}};
 const ticket=await beginYouTubeConnection(db,7,config),state=new URL(ticket.url).searchParams.get('state');
 assert.equal(new URL(ticket.url).pathname,'/auth/youtube/start');
 assert.equal(new URL(ticket.url).origin,new URL(config.redirectUri).origin);
 const result=await startYouTubeConnection(db,7,state,config),url=new URL(result.url);
 assert.equal(url.searchParams.get('access_type'),'offline');
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.match(url.searchParams.get('scope'),/youtube.upload/);assert.match(url.searchParams.get('scope'),/youtube.readonly/);
 assert.match(url.searchParams.get('state'),/^pub_/);assert.match(result.cookie,/HttpOnly; Secure; SameSite=Lax/);
 assert.equal(url.searchParams.get('redirect_uri'),config.redirectUri);
 assert.doesNotMatch(JSON.stringify(calls),new RegExp(url.searchParams.get('state')));
});
test('callback rejects absent browser binding and replay before contacting Google',async()=>{
 let contacts=0;
 const db={async query(){return {rows:[],rowCount:0}}},http=async()=>{contacts++;throw Error('Must not contact provider')};
 for(const cookie of ['',`onece_v2_youtube_state=${'b'.repeat(43)}`]){
  const res=response();await finishYouTubeConnection({headers:{cookie}},res,
   new URL(config.redirectUri+'?state=pub_'+'a'.repeat(43)+'&code=fixture-code'),db,config,http);
  assert.equal(res.status,302);assert.equal(res.headers.Location,config.webOrigin+'/app/upload?publishing=youtube-error');
 }
 assert.equal(contacts,0);
});
test('a successful OAuth callback stores encrypted refresh tokens, not access tokens',async()=>{
 const writes=[];const db={async query(sql,args){writes.push({sql,args});return sql.startsWith('DELETE')?
  {rows:[{user_id:7,verifier_cipher:sealPublishing('fixture-pkce','youtube-state:7',config.encryptionSecret)}],rowCount:1}:{rows:[],rowCount:1}}};
 const http=async(url)=>String(url).includes('/token')?Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',
  scope:'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly'}):
  Response.json({items:[{id:'UC'+'a'.repeat(22),snippet:{title:'Fixture channel'}}]});
 const res=response();await finishYouTubeConnection({headers:{cookie:'onece_v2_youtube_state='+'b'.repeat(43)}},res,
  new URL(config.redirectUri+'?state=pub_'+'a'.repeat(43)+'&code=fixture-code'),db,config,http);
 assert.match(res.headers.Location,/youtube-connected$/);
 const saved=writes.find(c=>c.sql.startsWith('INSERT INTO v2_youtube_connections'));
 assert.ok(saved);assert.doesNotMatch(JSON.stringify(saved),/fixture-refresh|fixture-access/);
 assert.equal(openPublishing(saved.args[1],'youtube-refresh:7',config.encryptionSecret),'fixture-refresh');
});
test('refresh revocation removes only the matching connection generation',async()=>{
 const queries=[];const generation=randomUUID();
 const db={async query(sql,args){queries.push({sql,args});return {rows:[{generation,refresh_cipher:sealPublishing('fixture-refresh','youtube-refresh:7',config.encryptionSecret)}]}}};
 await assert.rejects(youtubeAccess(db,7,config,async()=>Response.json({error:'invalid_grant'},{status:400})),/youtube_reconnect_required/);
 assert.match(queries[1].sql,/generation=\$2::uuid AND refresh_cipher=\$3/);
});
test('idempotency binds media IDs and privacy, with only real YouTube destinations accepted',()=>{
 const input={requestId:randomUUID(),title:'Fixture',description:'',hashtags:'',targets:[{platform:'youtube',variant:'shorts'}],audioFileId:1,coverFileId:2,privacy:'private'};
 const first=parsePublicationInput(input);
 assert.notEqual(parsePublicationInput({...input,privacy:'public'}).fingerprint,first.fingerprint);
 assert.notEqual(parsePublicationInput({...input,audioFileId:3}).fingerprint,first.fingerprint);
 assert.equal(parsePublicationInput({...input,requestId:randomUUID()}).fingerprint,first.fingerprint);
 assert.throws(()=>parsePublicationInput({...input,targets:[{platform:'tiktok',variant:'default'}]}));
 assert.throws(()=>parsePublicationInput({...input,audioFileId:-1}));
});
test('publishing HTTP mutations require authenticated session and exact origin before any schema or provider access',async()=>{
 const db={async query(){throw Error('Unexpected DB access')}};
 for(const [user,origin,status] of [[null,config.webOrigin,401],[{id:7},undefined,403],[{id:7},'https://evil.invalid',403]]){
  const req=Readable.from(['{}']);req.url='/api/publishing/jobs';req.method='POST';req.headers={origin};const res=response();
  await handlePublishing(req,res,req.url,db,async()=>user,{config,renderer:()=>true});assert.equal(res.status,status);
 }
 const req={method:'GET',headers:{},url:'/api/publishing/status'},res=response();
 await handlePublishing(req,res,req.url,db,async()=>({id:7}),{config:null});
 assert.deepEqual(JSON.parse(res.body),{available:false,connected:false,jobs:[]});
});
test('renderer rejects unknown/overlong duration',()=>{
 assert.equal(parseMediaDuration('Duration: 00:03:01.50'),181.5);
 for(const value of ['Duration: N/A','Duration: 00:20:01.00','Duration: 00:00:00.00'])assert.throws(()=>parseMediaDuration(value));
});
function png(){
 const crc=bytes=>{let n=0xffffffff;for(const b of bytes){n^=b;for(let j=0;j<8;j++)n=(n>>>1)^((n&1)?0xedb88320:0)}return (n^0xffffffff)>>>0};
 const chunk=(name,data)=>{const type=Buffer.from(name),length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([length,type,data,sum])};
 const header=Buffer.alloc(13);header.writeUInt32BE(16);header.writeUInt32BE(16,4);header[8]=8;header[9]=2;
 const pixels=Buffer.alloc(16*(16*3+1),128);for(let y=0;y<16;y++)pixels[y*49]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
function wav(){
 const frames=11025,bytes=Buffer.alloc(44+frames*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
 bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(44100,24);bytes.writeUInt32LE(88200,28);
 bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++)bytes.writeInt16LE(Math.round(Math.sin(i*.1)*12000),44+i*2);return bytes;
}
test('real FFmpeg renders a synthetic PNG/WAV into both promised aspect ratios',{skip:!publicationRendererAvailable()},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'onece-render-test-'));
 try{
  const audio=join(dir,'audio.wav'),cover=join(dir,'cover.png');await writeFile(audio,wav());await writeFile(cover,png());
  for(const [variant,dimensions] of [['shorts','720x1280'],['standard','1280x720']]){
   const output=join(dir,variant+'.mp4');await renderPublication({audio,cover,output,variant,signal:new AbortController().signal});
   assert.ok((await stat(output)).size>1000);
   const probe=spawnSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-i',output],{encoding:'utf8',windowsHide:true});
   assert.match(probe.stderr,new RegExp(dimensions));assert.match(probe.stderr,/Audio: aac/);assert.match(probe.stderr,/Video: h264/);
  }
 }finally{if(dirname(resolve(dir))===resolve(tmpdir())&&basename(dir).startsWith('onece-render-test-'))await rm(dir,{recursive:true,force:true});}
});
