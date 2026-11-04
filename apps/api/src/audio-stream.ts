// Shared 1CE v2 audio byte-range delivery. R2 stays private; callers authorize
// the original linked file BEFORE invoking this function.
import {GetObjectCommand} from '@aws-sdk/client-s3';

type AudioRange={status:200|206;start:number;end:number};
type AudioFile={
 byte_size:number|string;
 content_type:string;
 object_key:string;
};
type AudioRequest={headers:{range?:string}};
type AudioResponse={
 writeHead(status:number,headers:Record<string,string|number>):void;
 write(chunk:Uint8Array):unknown;
 end():void;
};
type StorageReader={
 send(command:GetObjectCommand):Promise<{Body?:AsyncIterable<Uint8Array>}>;
};

export function audioRange(range:string|undefined,byteSize:number|string):AudioRange|null{
 const size=Number(byteSize);
 if(!Number.isSafeInteger(size)||size<1)return null;
 if(!range)return {status:200,start:0,end:size-1};
 const match=/^bytes=(\d*)-(\d*)$/.exec(range);
 if(!match||(!match[1]&&!match[2]))return null;
 let start=0,end=size-1;
 if(!match[1]){
  const suffix=Number(match[2]);
  if(!Number.isSafeInteger(suffix)||suffix<=0)return null;
  start=Math.max(0,size-suffix);
 }else{
  start=Number(match[1]);
  if(match[2])end=Number(match[2]);
 }
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size)return null;
 return {status:206,start,end:Math.min(end,size-1)};
}
export async function streamAuthorizedAudio(req:AudioRequest,res:AudioResponse,{file,s3,bucket}:{file:AudioFile;s3:StorageReader;bucket:string}):Promise<void>{
 const range=audioRange(req.headers.range,file.byte_size);
 if(!range){
  res.writeHead(416,{'Content-Range':'bytes */'+file.byte_size,'Accept-Ranges':'bytes','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
  res.end();return;
 }
 const {status,start,end}=range;
 const object=await s3.send(new GetObjectCommand({Bucket:bucket,Key:file.object_key,...(status===206?{Range:'bytes='+start+'-'+end}:{})}));
 res.writeHead(status,{
  'Content-Type':file.content_type,
  'Content-Length':end-start+1,
  'Accept-Ranges':'bytes',
  'Cache-Control':'private, no-store',
  'X-Content-Type-Options':'nosniff',
  ...(status===206?{'Content-Range':'bytes '+start+'-'+end+'/'+file.byte_size}:{})
 });
 for await(const chunk of object.Body!)res.write(chunk);
 res.end();
}
