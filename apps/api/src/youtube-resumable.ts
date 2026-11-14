// YouTube resumable transport (R02), invoked only by publication-worker.ts
// after owner/grant checks, rendering and durable artifact checkpointing.
// Upload session URLs are bearer capabilities: never log or expose to browsers.
const START='https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const MAX_BYTES=256*1024*1024*1024;
const MULTIPLE=256*1024;
type Http=typeof fetch;
export type YouTubeUploadStatus=
 |{state:'pending';nextByte:number;retryAfterSeconds:number|null}
 |{state:'complete';videoId:string}
 |{state:'needs_review';httpStatus:number};

const text=(value:unknown,max:number,min=1):string=>{
 if(typeof value!=='string'||value.length>max||value.trim().length<min)
  throw Error('Invalid YouTube upload input');
 return value.trim();
};
const size=(value:number):number=>{
 if(!Number.isSafeInteger(value)||value<1||value>MAX_BYTES)
  throw Error('Invalid YouTube video length');
 return value;
};
const token=(accessToken:unknown):string=>{
 const value=text(accessToken,8192);
 if(/[\s\r\n]/.test(value))throw Error('Invalid access token');
 return value;
};
// Strict SSRF boundary: do not trust Location returned by any intermediary.
export function validateYouTubeSessionUri(value:unknown):string{
 if(typeof value!=='string'||value.length>4096)throw Error('Invalid YouTube upload session');
 let url:URL;
 try{url=new URL(value);}catch{throw Error('Invalid YouTube upload session');}
 if(url.protocol!=='https:'||url.hostname!=='www.googleapis.com'||url.port||
  url.username||url.password||url.hash||url.pathname!=='/upload/youtube/v3/videos'||
  url.searchParams.get('uploadType')!=='resumable'||!url.searchParams.get('upload_id'))
  throw Error('Invalid YouTube upload session');
 return url.href;
}
export async function beginYouTubeUpload(
 {accessToken,title,description='',totalBytes,privacy='private',http=fetch}:{
  accessToken:string;title:string;description?:string;totalBytes:number;
  privacy?:'private'|'unlisted'|'public';http?:Http
 }):Promise<string>{
 const auth=token(accessToken),safeTitle=text(title,100),safeDescription=text(description,5000,0);
 size(totalBytes);
 if(!['private','unlisted','public'].includes(privacy))throw Error('Invalid privacy selection');
 const response=await http(START,{
  method:'POST',redirect:'manual',headers:{
   Authorization:'Bearer '+auth,'Content-Type':'application/json; charset=UTF-8',
   'X-Upload-Content-Length':String(totalBytes),'X-Upload-Content-Type':'video/mp4'
  },
  body:JSON.stringify({snippet:{title:safeTitle,description:safeDescription},
   status:{privacyStatus:privacy}}),
  signal:AbortSignal.timeout(15000)
 });
 if(response.status!==200)throw Error('YouTube session initiation failed (HTTP '+response.status+')');
 return validateYouTubeSessionUri(response.headers.get('Location'));
}
async function parseResponse(response:Response,totalBytes:number):Promise<YouTubeUploadStatus>{
 if(response.status===308){
  const range=response.headers.get('Range');
  if(range!==null&&!/^bytes=0-[0-9]+$/.test(range))throw Error('Invalid YouTube progress range');
  const nextByte=range===null?0:Number(range.slice(8))+1;
  if(!Number.isSafeInteger(nextByte)||nextByte>=totalBytes)throw Error('Invalid YouTube progress offset');
  const retry=response.headers.get('Retry-After');
  const seconds=retry!==null&&/^\d+$/.test(retry)?Number(retry):null;
  return {state:'pending',nextByte,retryAfterSeconds:seconds!==null&&seconds<=86400?seconds:null};
 }
 if(response.status===200||response.status===201){
  const data:unknown=await response.json().catch(()=>null);
  if(!data||typeof data!=='object'||!('id' in data)||typeof data.id!=='string'||
   !/^[A-Za-z0-9_-]{6,32}$/.test(data.id))throw Error('YouTube confirmation is incomplete');
  return {state:'complete',videoId:data.id};
 }
 // 5xx, 404 session expiry, 401/403 and other uncertain outcomes need
 // authorization/status reconciliation; never blindly create another upload.
 return {state:'needs_review',httpStatus:response.status};
}
export async function probeYouTubeUpload(
 {sessionUri,accessToken,totalBytes,http=fetch}:{
  sessionUri:string;accessToken:string;totalBytes:number;http?:Http
 }):Promise<YouTubeUploadStatus>{
 const url=validateYouTubeSessionUri(sessionUri),auth=token(accessToken);
 size(totalBytes);
 const response=await http(url,{method:'PUT',redirect:'manual',headers:{
  Authorization:'Bearer '+auth,'Content-Length':'0','Content-Range':'bytes */'+totalBytes
 },signal:AbortSignal.timeout(15000)});
 return parseResponse(response,totalBytes);
}
export async function sendYouTubeChunk(
 {sessionUri,accessToken,totalBytes,start,bytes,http=fetch}:{
  sessionUri:string;accessToken:string;totalBytes:number;start:number;
  bytes:Uint8Array;http?:Http
 }):Promise<YouTubeUploadStatus>{
 const url=validateYouTubeSessionUri(sessionUri),auth=token(accessToken);
 size(totalBytes);
 if(!Number.isSafeInteger(start)||start<0||start>=totalBytes||
  !(bytes instanceof Uint8Array)||bytes.byteLength===0||bytes.byteLength>16*1024*1024||
  start+bytes.byteLength>totalBytes||
  (start+bytes.byteLength<totalBytes&&bytes.byteLength%MULTIPLE!==0))
  throw Error('Invalid YouTube chunk boundaries');
 const end=start+bytes.byteLength-1;
 const response=await http(url,{method:'PUT',redirect:'manual',headers:{
  Authorization:'Bearer '+auth,'Content-Type':'video/mp4',
  'Content-Length':String(bytes.byteLength),
  'Content-Range':'bytes '+start+'-'+end+'/'+totalBytes
 },body:Buffer.from(bytes),signal:AbortSignal.timeout(120000)});
 return parseResponse(response,totalBytes);
}
