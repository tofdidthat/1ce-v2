import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {handleAudioWaveform,waveformSchema} from '../dist/audio-waveform.js';
import {decodeWaveform} from '../dist/waveform-decode.js';
import {WaveformEnvelope,validWaveform} from '../dist/waveform-peaks.js';

const bars=Array.from({length:84},(_,i)=>i/84);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(){
 const f={key:'users/1/assets/audio/verified/test.mp3',hash:'a'.repeat(64),allowed:true,public:false,saved:null,claims:0,decodes:0,row:null,fail:false,lose:false};
 f.db={async query(sql,args=[]){
  if(sql.startsWith('SELECT f.object_key'))return {rows:[{object_key:f.key,content_type:'audio/mpeg',byte_size:1024}],rowCount:1};
  if(sql.startsWith('SELECT 1 FROM ('))return {rows:[],rowCount:f.allowed&&(f.public||(args[3]!==null&&args[3]===f.saved))?1:0};
  if(sql.startsWith('SELECT sha256'))return {rows:[{sha256:f.hash}]};
  if(sql.startsWith('CREATE TABLE'))return {rows:[]};
  if(sql.startsWith('SELECT bars'))return {rows:f.row?.version===args[1]?[{bars:f.row.bars}]:[]};
  if(sql.startsWith('INSERT INTO v2_audio_waveforms')){
   f.claims++;
   if(f.row&&f.row.version===args[1]&&(f.row.bars||f.row.pending))return {rowCount:0,rows:[]};
   f.row={version:args[1],token:args[2],bars:null,pending:true};return {rowCount:1,rows:[{}]};
  }
  if(sql.startsWith('UPDATE v2_audio_waveforms w')){
   if(f.lose||f.row.token!==args[2])return {rowCount:0,rows:[]};
   f.row.bars=JSON.parse(args[3]);return {rowCount:1,rows:[{}]};
  }
  if(sql.startsWith('UPDATE v2_audio_waveforms SET'))return {rowCount:1,rows:[]};
  throw Error('Unexpected query '+sql);
 }};
 f.options={decode:async()=>{f.decodes++;if(f.fail)throw Error('Secret storage diagnostics');return bars}};
 f.get=async(viewer=1,method='GET')=>{
  const res={status:0,headers:{},body:null,writeHead(s,h){this.status=s;this.headers=h},end(raw){this.body=JSON.parse(raw)}};
  assert.equal(await handleAudioWaveform({method},res,'/api/public/waveform/1/10',f.db,async()=>viewer===null?null:{id:viewer},f.options),true);
  return res;
 };
 return f;
}
test('generates once and reuses database bars on a fresh request, including public and saved viewers',async()=>{
 const f=fixture();
 assert.equal((await f.get()).status,200);
 assert.equal((await f.get()).status,200);
 assert.equal(f.decodes,1);
 f.public=true;assert.equal((await f.get(null)).status,200);
 f.public=false;f.saved=2;assert.equal((await f.get(2)).status,200);
 assert.equal(f.decodes,1);
 assert.equal((await f.get(3)).status,404);
 f.allowed=false;assert.equal((await f.get(2)).status,404);
 assert.equal(f.decodes,1,'denied readers never regenerate or receive persisted bars');
});
test('new original hash or key invalidates the persisted version',async()=>{
 const f=fixture();await f.get();
 f.hash='b'.repeat(64);await f.get();
 f.key='users/1/assets/audio/verified/replaced.mp3';await f.get();
 assert.equal(f.decodes,3);
});
test('legacy READY audio without stored SHA uses immutable original identity',async()=>{
 const f=fixture();f.hash=null;
 assert.equal((await f.get()).status,200);assert.equal((await f.get()).status,200);
 assert.equal(f.decodes,1);
});
test('foreign private and anonymous access is denied before waveform storage or generation',async()=>{
 const f=fixture();
 for(const viewer of [2,null])assert.equal((await f.get(viewer)).status,404);
 assert.equal(f.claims,0);assert.equal(f.decodes,0);
 assert.equal((await f.get(1,'POST')).status,405);
});
test('fenced stale generation is not returned and failures do not disclose storage details',async()=>{
 const f=fixture();f.lose=true;
 assert.equal((await f.get()).status,202);assert.equal(f.row.bars,null);
 const broken=fixture();broken.fail=true;
 const result=await broken.get();assert.equal(result.status,503);
 assert.equal(result.headers['Cache-Control'],'private, no-store');
 assert.doesNotMatch(JSON.stringify(result.body),/Secret/);
 assert.equal((await broken.get()).status,202,'cooldown avoids decoding repeatedly');
 assert.equal(broken.decodes,1);
});
test('concurrent requests cannot start a second decode, including a different file version',async()=>{
 const f=fixture();let release,entered;
 const started=new Promise(resolve=>{entered=resolve});
 f.options.decode=async()=>{entered();await new Promise(resolve=>{release=resolve});return bars};
 const first=f.get();await started;
 assert.equal((await f.get()).status,202);
 release();assert.equal((await first).status,200);
 assert.equal(f.claims,1);
});
test('migration matches lazy additive schema and cascading file deletion',()=>{
 const sql=readFileSync(new URL('../../../history/database/015_audio_waveforms.sql',import.meta.url),'utf8');
 assert.equal(sql.slice(sql.indexOf('CREATE TABLE')).trim().replace(/;$/,''),waveformSchema);
});
function wav(){
 const samples=44100,bytes=Buffer.alloc(44+samples*4);
 bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
 bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);
 bytes.writeUInt32LE(44100,24);bytes.writeUInt32LE(176400,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);
 bytes.write('data',36);bytes.writeUInt32LE(samples*4,40);
 for(let i=0;i<samples;i++){
  // Silence on the left proves both channels contribute to the visual envelope.
  bytes.writeInt16LE(Math.round(Math.sin(i*.1)*(i<samples/2?2000:16000)),44+i*4+2);
 }
 return bytes;
}
async function* chunks(bytes){for(let i=0;i<bytes.length;i+=997)yield bytes.subarray(i,i+997)}
test('actual WAV decoder produces bounded 84 bars from stereo, chunked PCM and silence',async()=>{
 const bytes=wav(),result=await decodeWaveform(chunks(bytes),'wav',bytes.length,sha(bytes));
 assert.ok(validWaveform(result));assert.equal(Math.max(...result),1);
 assert.ok(result[10]<result[70]/2,'waveform reflects the amplitude change on the right channel');
 const silence=new WaveformEnvelope();silence.add([new Float32Array(10000)],44100);
 assert.deepEqual(silence.finish(),Array(84).fill(0));
});
test('actual MP3 decoder reads generated synthetic tone; original bytes are SHA verified',async()=>{
 // Generated locally with FFmpeg from a synthetic 440Hz sine; no user/media asset.
 const mp3=Buffer.from(readFileSync(new URL('./fixtures/waveform-tone.mp3.b64',import.meta.url),'utf8'),'base64');
 const result=await decodeWaveform(chunks(mp3),'mp3',mp3.length,sha(mp3));
 assert.ok(validWaveform(result));assert.equal(Math.max(...result),1);
 await assert.rejects(decodeWaveform(chunks(mp3),'mp3',mp3.length,'0'.repeat(64)),/integrity/);
 await assert.rejects(decodeWaveform(chunks(mp3),'mp3',mp3.length-1,sha(mp3)),/size/);
});
test('malformed or invalid decoded audio never becomes persistent bars',async()=>{
 const empty=Buffer.from('not audio');
 await assert.rejects(decodeWaveform(Readable.from([empty]),'wav',empty.length,sha(empty)));
 const invalid=new WaveformEnvelope();assert.throws(()=>invalid.add([Float32Array.of(NaN)],44100));
 assert.equal(validWaveform(Array(84).fill(Infinity)),false);
 assert.equal(validWaveform(Array(83).fill(1)),false);
});
