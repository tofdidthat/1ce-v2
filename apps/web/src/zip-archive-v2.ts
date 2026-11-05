// Dependency-free ZIP32 STORE writer. Keeps original bytes and creates no R2 copies.
// Use only with authorized owner downloads; the API checks permissions per file.
export type ZipEntryV2={name:string;body:Blob};
const LIMIT_BYTES=750*1024*1024;
const encoder=new TextEncoder();
export function safeZipSegmentV2(value:string):string{
 const name=value.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,' ').replace(/[. ]+$/g,'').trim().slice(0,100);
 return name||'Untitled';
}
function crcUpdate(crc:number,bytes:Uint8Array):number{
 let n=crc;
 for(const byte of bytes){
  n^=byte;
  for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);
 }
 return n;
}
async function checksum(blob:Blob,signal?:AbortSignal):Promise<number>{
 const reader=blob.stream().getReader();
 let crc=0xffffffff;
 try{
  while(true){
   if(signal?.aborted)throw new DOMException('Download cancelled','AbortError');
   const {value,done}=await reader.read();
   if(done)break;
   crc=crcUpdate(crc,value);
  }
 }finally{reader.releaseLock();}
 return (crc^0xffffffff)>>>0;
}
function record(length:number):{bytes:Uint8Array;view:DataView}{
 const bytes=new Uint8Array(length);
 return {bytes,view:new DataView(bytes.buffer)};
}
export async function zipArchiveV2(entries:ZipEntryV2[],signal?:AbortSignal):Promise<Blob>{
 if(!entries.length||entries.length>1024)throw Error('Invalid archive entry count');
 const total=entries.reduce((sum,entry)=>sum+entry.body.size,0);
 if(!Number.isSafeInteger(total)||total>LIMIT_BYTES)throw Error('Pack exceeds the browser ZIP limit (750 MB). Download tracks individually.');
 const parts:BlobPart[]=[],central:BlobPart[]=[];
 let offset=0,centralBytes=0;
 for(const entry of entries){
  if(signal?.aborted)throw new DOMException('Download cancelled','AbortError');
  const name=encoder.encode(entry.name);
  const size=entry.body.size;
  if(!name.length||name.length>65535||!Number.isSafeInteger(size)||size>0xffffffff)throw Error('Invalid ZIP entry');
  const crc=await checksum(entry.body,signal);
  const local=record(30+name.length);
  local.view.setUint32(0,0x04034b50,true);
  local.view.setUint16(4,20,true);
  local.view.setUint16(6,0x0800,true); // UTF-8
  local.view.setUint32(14,crc,true);
  local.view.setUint32(18,size,true);
  local.view.setUint32(22,size,true);
  local.view.setUint16(26,name.length,true);
  local.bytes.set(name,30);
  parts.push(local.bytes,entry.body);
  const directory=record(46+name.length);
  directory.view.setUint32(0,0x02014b50,true);
  directory.view.setUint16(4,20,true);
  directory.view.setUint16(6,20,true);
  directory.view.setUint16(8,0x0800,true);
  directory.view.setUint32(16,crc,true);
  directory.view.setUint32(20,size,true);
  directory.view.setUint32(24,size,true);
  directory.view.setUint16(28,name.length,true);
  directory.view.setUint32(42,offset,true);
  directory.bytes.set(name,46);
  central.push(directory.bytes);
  offset+=local.bytes.length+size;
  centralBytes+=directory.bytes.length;
  if(offset+centralBytes>0xffffffff)throw Error('ZIP exceeds ZIP32 capacity');
 }
 const end=record(22);
 end.view.setUint32(0,0x06054b50,true);
 end.view.setUint16(8,entries.length,true);
 end.view.setUint16(10,entries.length,true);
 end.view.setUint32(12,centralBytes,true);
 end.view.setUint32(16,offset,true);
 return new Blob([...parts,...central,end.bytes],{type:'application/zip'});
}
export function saveBlobV2(blob:Blob,name:string):void{
 const href=URL.createObjectURL(blob);
 const link=document.createElement('a');
 link.href=href;link.download=name;
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(href),30_000);
}
