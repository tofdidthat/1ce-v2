import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {zipArchiveV2,safeZipSegmentV2} from '../src/zip-archive-v2.ts';

// Executed with --experimental-strip-types in CI. This tests the actual TS ZIP
// writer, then uses an independent system unzip implementation to read it.
function realWav(frequency,frames=4000){
 const data=Buffer.alloc(44+frames*2);
 data.write('RIFF',0,'ascii');data.writeUInt32LE(data.length-8,4);
 data.write('WAVEfmt ',8,'ascii');data.writeUInt32LE(16,16);
 data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);
 data.writeUInt32LE(16000,24);data.writeUInt32LE(32000,28);
 data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);
 data.write('data',36,'ascii');data.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++)data.writeInt16LE(Math.round(3000*Math.sin(2*Math.PI*frequency*i/16000)),44+i*2);
 return data;
}
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
async function bytes(blob){return Buffer.from(await blob.arrayBuffer());}

test('real WAV audio and nested stems ZIP extract byte-for-byte from generated pack',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'onece-v2-zip-'));
 try{
  const beatA=realWav(440),beatB=realWav(659);
  const kick=realWav(100,2000),bass=realWav(70,2000);
  const stems=await zipArchiveV2([
   {name:'kick.wav',body:new Blob([kick])},
   {name:'bass.wav',body:new Blob([bass])}
  ]);
  const folder=safeZipSegmentV2('Session: 1 / pack');
  const first=folder+'/01 - '+safeZipSegmentV2('Lead/Keys')+'.wav';
  const second=folder+'/02 - '+safeZipSegmentV2('Drums')+'.wav';
  const stemName=folder+'/stems/01 - '+safeZipSegmentV2('Lead/Keys')+'.zip';
  const entries=[
   {name:first,body:new Blob([beatA])},
   {name:stemName,body:stems},
   {name:second,body:new Blob([beatB])}
  ];
  const pack=await zipArchiveV2(entries);
  const path=join(directory,'pack.zip');
  await writeFile(path,await bytes(pack));
  assert.match(execFileSync('unzip',['-t',path],{encoding:'utf8'}),/No errors detected/);
  const names=execFileSync('unzip',['-Z','-1',path],{encoding:'utf8'}).trim().split('\\n');
  assert.deepEqual(names,entries.map(x=>x.name));
  for(const [name,original] of [[first,beatA],[second,beatB],[stemName,await bytes(stems)]]){
   const extracted=execFileSync('unzip',['-p',path,name]);
   assert.equal(sha256(extracted),sha256(original),'ZIP changed original bytes: '+name);
  }
  const nestedPath=join(directory,'stems.zip');
  await writeFile(nestedPath,execFileSync('unzip',['-p',path,stemName]));
  assert.match(execFileSync('unzip',['-t',nestedPath],{encoding:'utf8'}),/No errors detected/);
  assert.equal(sha256(execFileSync('unzip',['-p',nestedPath,'kick.wav'])),sha256(kick));
  assert.equal(sha256(execFileSync('unzip',['-p',nestedPath,'bass.wav'])),sha256(bass));
 }finally{await rm(directory,{recursive:true,force:true})}
});

test('ZIP entry paths cannot inherit traversal or separators from project titles',()=>{
 for(const name of ['../../other','C:\\Users\\test','...','a/b:c*?','  ']){
  const segment=safeZipSegmentV2(name);
  assert.ok(segment.length>0);
  assert.ok(!/[\\\\/:*?"<>|]/.test(segment));
  assert.notEqual(segment,'..');
 }
});

test('empty archives and cancelled archive creation reject before saving',async()=>{
 await assert.rejects(zipArchiveV2([]),/Invalid archive entry count/);
 const abort=new AbortController();abort.abort();
 await assert.rejects(zipArchiveV2([{name:'test.wav',body:new Blob([realWav(440,20)])}],abort.signal),/Download cancelled/);
});
