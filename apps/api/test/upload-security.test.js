import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {InvalidMedia,VerificationUnavailable,verifyUploadedObject} from '../src/upload-security.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const file=(bytes,kind='stems',content_type='application/zip')=>({
 kind,content_type,byte_size:bytes.length,sha256:sha(bytes)
});
const storage=bytes=>({async send(command){
 if(command.constructor.name!=='GetObjectCommand')throw Error('Unexpected R2 command');
 const range=command.input.Range;
 if(range){
  const m=/^bytes=(\d+)-(\d+)$/.exec(range);
  const start=Number(m[1]),end=Number(m[2]),slice=bytes.subarray(start,end+1);
  return {Body:Readable.from([slice]),ContentLength:slice.length,
   ContentRange:'bytes '+start+'-'+end+'/'+bytes.length};
 }
 return {Body:Readable.from([bytes]),ContentLength:bytes.length};
}});
function zip(name='stems/track.wav',{unpacked,attrs=0,encrypted=false}={}){
 const nameBytes=Buffer.from(name),payload=Buffer.from('WAV');
 const local=Buffer.alloc(30+nameBytes.length+payload.length);
 local.writeUInt32LE(0x04034b50,0);
 local.writeUInt16LE(encrypted?1:0,6);
 local.writeUInt32LE(payload.length,18);
 local.writeUInt32LE(unpacked??payload.length,22);
 local.writeUInt16LE(nameBytes.length,26);
 nameBytes.copy(local,30);payload.copy(local,30+nameBytes.length);
 const central=Buffer.alloc(46+nameBytes.length);
 central.writeUInt32LE(0x02014b50,0);
 central.writeUInt16LE(3<<8,4);
 central.writeUInt16LE(encrypted?1:0,8);
 central.writeUInt32LE(payload.length,20);
 central.writeUInt32LE(unpacked??payload.length,24);
 central.writeUInt16LE(nameBytes.length,28);
 central.writeUInt32LE(attrs,38);
 nameBytes.copy(central,46);
 const eocd=Buffer.alloc(22);
 eocd.writeUInt32LE(0x06054b50,0);
 eocd.writeUInt16LE(1,8);eocd.writeUInt16LE(1,10);
 eocd.writeUInt32LE(central.length,12);
 eocd.writeUInt32LE(local.length,16);
 return Buffer.concat([local,central,eocd]);
}
const verify=bytes=>verifyUploadedObject({s3:storage(bytes),bucket:'mock',key:'object',file:file(bytes)});

test('valid stored ZIP passes streamed SHA and central-directory verification',async()=>{
 const bytes=zip();
 await assert.doesNotReject(()=>verify(bytes));
});
test('ZIP path traversal and symlinks are rejected before READY',async()=>{
 for(const bytes of [zip('../secret.wav'),zip('safe/link',{attrs:0xa0000000})]){
  await assert.rejects(()=>verify(bytes),InvalidMedia);
 }
});
test('encrypted ZIP and high-expansion ZIP bombs are rejected',async()=>{
 for(const bytes of [zip('secret.wav',{encrypted:true}),zip('huge.wav',{unpacked:2147483648})]){
  await assert.rejects(()=>verify(bytes),InvalidMedia);
 }
});
test('forged ZIP header without a central directory is rejected',async()=>{
 const bytes=Buffer.from('PK\x03\x04not a real zip');
 await assert.rejects(()=>verify(bytes),InvalidMedia);
});
test('streamed bytes are bounded even if storage misreports ContentLength',async()=>{
 const bytes=zip(),s3={async send(){
  return {Body:Readable.from([Buffer.concat([bytes,Buffer.alloc(1)])]),ContentLength:bytes.length};
 }};
 await assert.rejects(()=>verifyUploadedObject({s3,bucket:'mock',key:'x',file:file(bytes)}),InvalidMedia);
});
test('stalled R2 Body is aborted on a short injected deadline',async()=>{
 const bytes=zip(),s3={async send(){return {Body:new Readable({read(){}}),ContentLength:bytes.length};}};
 await assert.rejects(
  ()=>verifyUploadedObject({s3,bucket:'mock',key:'x',file:file(bytes),timeoutMs:25}),
  VerificationUnavailable
 );
});

test('ZIP central filename cannot conceal a different local-header path',async()=>{
 const bytes=zip('safe.wav');
 // Local and central names have the same length, but differ in content.
 Buffer.from('evil.wav').copy(bytes,30);
 await assert.rejects(()=>verify(bytes),/local filename disagrees/);
});
