// Server-side verification for immutable 1CE v2 media. Never expose a ready
// object key through a signed PUT URL. No full-file buffering or decompression.
import {createHash} from 'node:crypto';
import {GetObjectCommand} from '@aws-sdk/client-s3';

export class InvalidMedia extends Error {
 constructor(message){super(message);this.name='InvalidMedia';}
}
export class VerificationUnavailable extends Error {
 constructor(message){super(message);this.name='VerificationUnavailable';}
}

const MB=1024*1024;
const SIGNATURE_BYTES=4096;
const MAX_ZIP_ENTRIES=1000;
const MAX_ZIP_DIRECTORY=2*MB;
const MAX_ZIP_EXPANDED=2*1024*MB;
const ZIP_TAIL=65557; // EOCD, maximum 65535-byte comment
const maxTime={audio:120000,cover:45000,stems:180000};
const matches=(bytes,offset,signature)=>bytes.length>=offset+signature.length&&
 bytes.subarray(offset,offset+signature.length).equals(Buffer.from(signature));

async function readObject(s3,bucket,key,{range,maxBytes,timeoutMs,onChunk}){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(new Error('R2 verification deadline exceeded')),timeoutMs);
 timer.unref?.();
 let body;
 try{
  const object=await s3.send(new GetObjectCommand({Bucket:bucket,Key:key,...(range?{Range:range}: {})}),{abortSignal:controller.signal});
  body=object.Body;
  if(!body||typeof body[Symbol.asyncIterator]!=='function')throw new VerificationUnavailable('R2 did not provide a readable body');
  if(Number.isFinite(Number(object.ContentLength))&&Number(object.ContentLength)>maxBytes)
   throw new InvalidMedia('R2 response exceeds the permitted size');
  const stop=()=>body.destroy?.(new Error('R2 verification deadline exceeded'));
  controller.signal.addEventListener('abort',stop,{once:true});
  let total=0;
  try{
   for await(const raw of body){
    const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
    total+=chunk.length;
    if(total>maxBytes)throw new InvalidMedia('R2 streamed more bytes than permitted');
    onChunk(chunk);
   }
  }finally{controller.signal.removeEventListener('abort',stop);}
  return {total,contentRange:object.ContentRange};
 }catch(err){
  if(controller.signal.aborted)throw new VerificationUnavailable('R2 verification timed out');
  if(err instanceof InvalidMedia||err instanceof VerificationUnavailable)throw err;
  throw new VerificationUnavailable('R2 verification read failed');
 }finally{clearTimeout(timer);body?.destroy?.();}
}

async function rangedBytes(s3,bucket,key,start,end,timeoutMs=15000){
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end-start+1>MAX_ZIP_DIRECTORY)
  throw new InvalidMedia('Invalid ZIP verification range');
 const chunks=[],expected=end-start+1;
 const result=await readObject(s3,bucket,key,{
  range:`bytes=${start}-${end}`,maxBytes:expected,timeoutMs,onChunk:chunk=>chunks.push(chunk)
 });
 if(result.total!==expected||result.contentRange!==`bytes ${start}-${end}/*`&&
  !new RegExp(`^bytes ${start}-${end}/[0-9]+$`).test(result.contentRange||''))
  throw new InvalidMedia('R2 did not honor the ZIP byte range');
 return Buffer.concat(chunks,expected);
}

function validateSignature(file,prefix,tail){
 const {kind,content_type:contentType,byte_size:size}=file;
 if(kind==='audio'&&['audio/mpeg','audio/mp3'].includes(contentType)){
  const id3=matches(prefix,0,[0x49,0x44,0x33])&&prefix.length>=10&&
   prefix[3]>=2&&prefix[3]<=4&&prefix[4]===0&&
   [...prefix.subarray(6,10)].every(n=>n<128);
  const frame=prefix.length>=4&&prefix[0]===0xff&&(prefix[1]&0xe0)===0xe0&&
   (prefix[1]&0x18)!==0x08&&(prefix[2]&0xf0)!==0xf0&&(prefix[2]&0x0c)!==0x0c;
  if(!id3&&!frame)throw new InvalidMedia('Invalid MP3 signature');
  if(id3){
   const tagSize=((prefix[6]<<21)|(prefix[7]<<14)|(prefix[8]<<7)|prefix[9])+10;
   if(tagSize>=size)throw new InvalidMedia('MP3 ID3 tag has no audio payload');
  }
  return;
 }
 if(kind==='audio'&&['audio/wav','audio/x-wav','audio/wave'].includes(contentType)){
  if(size<44||!matches(prefix,0,'RIFF')||!matches(prefix,8,'WAVE')||
   !prefix.includes(Buffer.from('fmt '),12)||!prefix.includes(Buffer.from('data'),12))
   throw new InvalidMedia('Invalid WAV container');
  return;
 }
 if(kind==='cover'&&contentType==='image/jpeg'){
  if(size<4||!matches(prefix,0,[0xff,0xd8,0xff])||!matches(tail,tail.length-2,[0xff,0xd9]))
   throw new InvalidMedia('Invalid JPEG signature');
  return;
 }
 if(kind==='cover'&&contentType==='image/png'){
  if(size<45||!matches(prefix,0,[137,80,78,71,13,10,26,10])||
   prefix.readUInt32BE(8)!==13||!matches(prefix,12,'IHDR')||
   !matches(tail,tail.length-12,[0,0,0,0,73,69,78,68]))
   throw new InvalidMedia('Invalid PNG structure');
  return;
 }
 if(kind==='cover'&&contentType==='image/webp'){
  if(size<20||!matches(prefix,0,'RIFF')||!matches(prefix,8,'WEBP')||
   !['VP8 ','VP8L','VP8X'].some(x=>matches(prefix,12,x)))
   throw new InvalidMedia('Invalid WebP container');
  return;
 }
 if(kind==='stems'&&['application/zip','application/x-zip-compressed'].includes(contentType)){
  if(!matches(prefix,0,[0x50,0x4b,0x03,0x04]))throw new InvalidMedia('Invalid ZIP signature');
  return;
 }
 throw new InvalidMedia('Unsupported media kind or MIME type');
}

async function validateZip(s3,bucket,key,size){
 const start=Math.max(0,size-ZIP_TAIL);
 const tail=await rangedBytes(s3,bucket,key,start,size-1);
 let eocd=-1;
 for(let i=tail.length-22;i>=0;i--){
  if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tail.length){eocd=i;break;}
 }
 if(eocd<0)throw new InvalidMedia('ZIP end-of-directory not found');
 if(tail.readUInt16LE(eocd+4)!==0||tail.readUInt16LE(eocd+6)!==0)
  throw new InvalidMedia('Multi-disk ZIP is not supported');
 const count=tail.readUInt16LE(eocd+10),onDisk=tail.readUInt16LE(eocd+8);
 const dirSize=tail.readUInt32LE(eocd+12),dirOffset=tail.readUInt32LE(eocd+16);
 if(!count||count!==onDisk||count===0xffff||dirSize===0xffffffff||dirOffset===0xffffffff||
  count>MAX_ZIP_ENTRIES||dirSize>MAX_ZIP_DIRECTORY||!dirSize||
  dirOffset+dirSize!==start+eocd)
  throw new InvalidMedia('ZIP directory limits or offsets are invalid');
 const dir=await rangedBytes(s3,bucket,key,dirOffset,dirOffset+dirSize-1);
 let offset=0,expanded=0,files=0;
 for(let i=0;i<count;i++){
  if(offset+46>dir.length||dir.readUInt32LE(offset)!==0x02014b50)
   throw new InvalidMedia('Invalid ZIP central directory entry');
  const flags=dir.readUInt16LE(offset+8),method=dir.readUInt16LE(offset+10);
  const packed=dir.readUInt32LE(offset+20),unpacked=dir.readUInt32LE(offset+24);
  const nameLength=dir.readUInt16LE(offset+28),extraLength=dir.readUInt16LE(offset+30);
  const commentLength=dir.readUInt16LE(offset+32),disk=dir.readUInt16LE(offset+34);
  const attrs=dir.readUInt32LE(offset+38),localOffset=dir.readUInt32LE(offset+42);
  const end=offset+46+nameLength+extraLength+commentLength;
  if(end>dir.length||!nameLength||disk||localOffset>=dirOffset||
   packed===0xffffffff||unpacked===0xffffffff||localOffset===0xffffffff||
   (flags&1)!==0||![0,8].includes(method))
   throw new InvalidMedia('Unsupported or encrypted ZIP entry');
  const rawName=dir.subarray(offset+46,offset+46+nameLength);
  const name=rawName.toString(flags&0x800?'utf8':'latin1');
  const parts=name.split('/');
  if(name.includes('\\')||name.startsWith('/')||name.includes(':')||
   /[\x00-\x1f\x7f]/.test(name)||parts.some(p=>p==='.'||p==='..')||
   (attrs>>>16&0xf000)===0xa000)
   throw new InvalidMedia('Unsafe ZIP entry path or symlink');
  if(!name.endsWith('/')){
   files++;
   expanded+=unpacked;
   if(expanded>MAX_ZIP_EXPANDED||unpacked>1024*MB||
    (packed===0&&unpacked>0)||(packed>0&&unpacked/packed>1000))
    throw new InvalidMedia('ZIP expansion limits exceeded');
  }
  offset=end;
 }
 if(offset!==dir.length||files===0)throw new InvalidMedia('ZIP directory is inconsistent or empty');
}

export async function verifyUploadedObject({s3,bucket,key,file}){
 const size=Number(file.byte_size);
 if(!Number.isSafeInteger(size)||size<1||!['audio','cover','stems'].includes(file.kind))
  throw new InvalidMedia('Invalid stored media metadata');
 const hash=createHash('sha256');
 let prefix=Buffer.alloc(0),tail=Buffer.alloc(0);
 const {total}=await readObject(s3,bucket,key,{
  maxBytes:size,timeoutMs:maxTime[file.kind],onChunk:chunk=>{
   hash.update(chunk);
   if(prefix.length<SIGNATURE_BYTES)prefix=Buffer.concat([prefix,chunk.subarray(0,SIGNATURE_BYTES-prefix.length)]);
   tail=Buffer.concat([tail,chunk]).subarray(Math.max(0,tail.length+chunk.length-16));
  }
 });
 if(total!==size)throw new InvalidMedia('Uploaded file size mismatch');
 if(hash.digest('hex')!==file.sha256)throw new InvalidMedia('File checksum mismatch');
 validateSignature(file,prefix,tail);
 if(file.kind==='stems')await validateZip(s3,bucket,key,size);
}
