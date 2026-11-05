// Opt-in PR #57 byte-integrity smoke against an ISOLATED Cloudflare R2 bucket.
// Run from repo root with Node >=22 and --experimental-strip-types.
// Does not use the app database, user media bucket or production account auth.
// The app's browser ZIP remains local; this smoke uploads original WAVs and
// stems ZIP only, then builds the pack archive from real R2 GET responses.
import {randomUUID,createHash} from 'node:crypto';
import {S3Client,PutObjectCommand,HeadObjectCommand,CopyObjectCommand,
 GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {zipArchiveV2,safeZipSegmentV2} from '../../web/src/zip-archive-v2.ts';

const {R2_SMOKE_ACCOUNT_ID:account,R2_SMOKE_KEY_ID:key,
 R2_SMOKE_SECRET:secret,R2_SMOKE_BUCKET:bucket}=process.env;
if(!account||!key||!secret||!bucket||!/^onece-s2-smoke-[a-z0-9-]+$/.test(bucket))
 throw Error('Use dedicated R2_SMOKE_* credentials and an isolated onece-s2-smoke-* bucket');
if(bucket===process.env.R2_BUCKET_NAME)
 throw Error('Refusing to touch the 1CE production media bucket');
const client=new S3Client({region:'auto',
 endpoint:'https://'+account+'.r2.cloudflarestorage.com',
 credentials:{accessKeyId:key,secretAccessKey:secret},forcePathStyle:true});
const prefix='pr57-smoke/'+randomUUID()+'/';
const uploaded=new Set();
const sha256=data=>createHash('sha256').update(data).digest('hex');
const insist=(truth,message)=>{if(!truth)throw Error(message);};
async function blobBytes(blob){return Buffer.from(await blob.arrayBuffer());}
function validWav(freq){
 const rate=16000,frames=3200,out=Buffer.alloc(44+frames*2);
 out.write('RIFF',0,'ascii');out.writeUInt32LE(out.length-8,4);
 out.write('WAVEfmt ',8,'ascii');out.writeUInt32LE(16,16);
 out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);
 out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);
 out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);
 out.write('data',36,'ascii');out.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++)out.writeInt16LE(Math.round(5000*Math.sin(2*Math.PI*freq*i/rate)),44+2*i);
 return out;
}
async function read(key,range){
 const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:key,...(range?{Range:range}:{})}));
 const chunks=[];for await(const chunk of response.Body)chunks.push(Buffer.from(chunk));
 return Buffer.concat(chunks);
}
async function putAndVerify(name,original,mime){
 const staging=prefix+'staging/'+name,ready=prefix+'verified/'+name;
 uploaded.add(staging);
 const signed=await getSignedUrl(client,new PutObjectCommand({
  Bucket:bucket,Key:staging,ContentType:mime,ContentLength:original.length
 }),{expiresIn:120});
 const put=await fetch(signed,{method:'PUT',headers:{'Content-Type':mime},
  body:original,signal:AbortSignal.timeout(30000)});
 insist(put.ok,'Signed PUT failed for '+name+': '+put.status);
 const head=await client.send(new HeadObjectCommand({Bucket:bucket,Key:staging}));
 insist(Number(head.ContentLength)===original.length,'R2 HEAD size mismatch for '+name);
 insist(head.ContentType===mime,'R2 HEAD MIME mismatch for '+name);
 insist(!!head.ETag,'R2 HEAD missing ETag for '+name);
 uploaded.add(ready);
 await client.send(new CopyObjectCommand({
  Bucket:bucket,Key:ready,CopySource:bucket+'/'+staging,CopySourceIfMatch:head.ETag
 }));
 const first=await read(ready,'bytes=0-31');
 insist(first.equals(original.subarray(0,32)),'R2 ranged read mismatch for '+name);
 const roundTrip=await read(ready);
 insist(sha256(roundTrip)===sha256(original),'R2 SHA-256 mismatch for '+name);
 return {staging,ready,roundTrip,signed,originalEtag:head.ETag};
}
// Independent reader for ZIP32 STORE. Verify record offsets, paths, sizes,
// content and CRC. Reject unsupported compression, encryption, or traversal.
function storedZip(buf){
 const view=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
 insist(buf.length>=22,'Truncated ZIP');
 let end=-1;
 for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--){
  if(view.getUint32(i,true)===0x06054b50){end=i;break;}
 }
 insist(end>=0,'Missing ZIP end record');
 const total=view.getUint16(end+10,true),offset=view.getUint32(end+16,true);
 let pos=offset;const entries=new Map();
 for(let i=0;i<total;i++){
  insist(pos+46<=buf.length&&view.getUint32(pos,true)===0x02014b50,'Invalid central record');
  const method=view.getUint16(pos+10,true),crc=view.getUint32(pos+16,true);
  const compressed=view.getUint32(pos+20,true),size=view.getUint32(pos+24,true);
  const length=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true);
  const local=view.getUint32(pos+42,true);
  const name=new TextDecoder('utf-8',{fatal:true}).decode(buf.subarray(pos+46,pos+46+length));
  insist(method===0&&compressed===size,'Unexpected ZIP compression');
  insist(name&&!name.startsWith('/')&&!name.split('/').includes('..')&&!name.includes('\\'),'Unsafe ZIP path');
  insist(!entries.has(name),'Duplicate ZIP path');
  insist(local+30<=buf.length&&view.getUint32(local,true)===0x04034b50,'Invalid local record');
  const begin=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
  insist(begin+size<=buf.length,'Truncated ZIP entry');
  const bytes=buf.subarray(begin,begin+size);
  let value=0xffffffff;
  for(const byte of bytes){value^=byte;for(let b=0;b<8;b++)value=(value>>>1)^((value&1)?0xedb88320:0);}
  insist(((value^0xffffffff)>>>0)===crc,'ZIP CRC32 mismatch for '+name);
  entries.set(name,bytes);pos+=46+length+extra+comment;
 }
 insist(pos===offset+view.getUint32(end+12,true),'Central directory size mismatch');
 return entries;
}
try{
 const beat1=validWav(440),beat2=validWav(660);
 const stemsOriginal=await blobBytes(await zipArchiveV2([
  {name:'drums.wav',body:new Blob([validWav(90)])},
  {name:'bass.wav',body:new Blob([validWav(180)])}
 ]));
 insist(storedZip(stemsOriginal).size===2,'Local stems ZIP not readable');
 const [r1,r2,rs]=await Promise.all([
  putAndVerify('beat-one.wav',beat1,'audio/wav'),
  putAndVerify('beat-two.wav',beat2,'audio/wav'),
  putAndVerify('stems.zip',stemsOriginal,'application/zip')
 ]);
 // A leaked staging PUT URL must NOT be able to modify verified final bytes.
 const replacement=Buffer.alloc(stemsOriginal.length,0x52);
 const overwrite=await fetch(rs.signed,{method:'PUT',
  headers:{'Content-Type':'application/zip'},body:replacement,signal:AbortSignal.timeout(30000)});
 insist(overwrite.ok,'Staging PUT overwrite probe failed');
 insist(sha256(await read(rs.ready))===sha256(stemsOriginal),'R2 verified stems changed after staging overwrite');
 let staleRejected=false;
 const race=prefix+'race-cannot-copy.zip';uploaded.add(race);
 try{
  await client.send(new CopyObjectCommand({
   Bucket:bucket,Key:race,CopySource:bucket+'/'+rs.staging,CopySourceIfMatch:rs.originalEtag
  }));
 }catch(error){staleRejected=error?.$metadata?.httpStatusCode===412;}
 insist(staleRejected,'Stale source ETag unexpectedly allowed conditional copy');
 const folder=safeZipSegmentV2('PR57 R2 real media');
 const first=folder+'/01 - melody.wav',second=folder+'/02 - drums.wav',stem=folder+'/stems/01 - melody.zip';
 const pack=await blobBytes(await zipArchiveV2([
  {name:first,body:new Blob([r1.roundTrip])},
  {name:stem,body:new Blob([rs.roundTrip])},
  {name:second,body:new Blob([r2.roundTrip])}
 ]));
 const files=storedZip(pack);
 insist([...files.keys()].join('|')===[first,stem,second].join('|'),'Pack order/folder layout changed');
 insist(sha256(files.get(first))===sha256(beat1),'Pack beat 1 changed');
 insist(sha256(files.get(second))===sha256(beat2),'Pack beat 2 changed');
 insist(sha256(files.get(stem))===sha256(stemsOriginal),'Pack stems changed');
 insist(storedZip(files.get(stem)).size===2,'Nested stems ZIP cannot be opened');
 // The S3 endpoint must reject unsigned reads of the private smoke object.
 const raw=await fetch('https://'+account+'.r2.cloudflarestorage.com/'+bucket+'/'+rs.ready,
  {signal:AbortSignal.timeout(15000)});
 insist(!raw.ok,'Unsigned S3 endpoint unexpectedly served a private stems ZIP');
 console.log('PR57 REAL R2 SMOKE PASS: 3 signed PUTs; HEAD/ETag; immutable copy; GET/Range; SHA-256;');
 console.log('valid nested stems ZIP; ordered pack ZIP; CRC32; original WAV bytes; unsigned S3 GET denied.');
 console.log('NOTE: DB attachment, account permissions, replacement and detach still require authenticated app QA.');
}finally{
 for(const object of [...uploaded].reverse()){
  try{await client.send(new DeleteObjectCommand({Bucket:bucket,Key:object}));}
  catch(error){console.error('CLEANUP WARNING: inspect isolated smoke prefix',prefix,error?.name);}
 }
 client.destroy();
}