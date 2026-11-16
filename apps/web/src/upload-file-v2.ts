type UploadStage='hashing'|'initializing'|'transferring'|'verifying';
const names={audio:'audio',cover:'image'} as const;
function networkFailure(stage:Exclude<UploadStage,'hashing'>,kind:'audio'|'cover'):Error{
 const item=names[kind];
 if(stage==='initializing')return Error('Could not contact the 1CE upload API while starting the '+item+' upload. Check your connection and browser Network tab for a blocked POST or CORS preflight. No publication job was submitted.');
 if(stage==='transferring')return Error('The browser could not send the '+item+' to Cloudflare R2. Check the bucket CORS rules: https://1ce.lol must allow PUT and Content-Type. No publication job was submitted.');
 return Error('Could not confirm the '+item+' upload with the 1CE API. The file may already be stored; retry with the same files and review Publishing history before resubmitting.');
}
async function request(stage:Exclude<UploadStage,'hashing'>,kind:'audio'|'cover',
 signal:AbortSignal,perform:()=>Promise<Response>):Promise<Response>{
 try{return await perform();}
 catch(error){
  if(signal.aborted)throw error;
  if(error instanceof TypeError)throw networkFailure(stage,kind);
  throw error;
 }
}
export async function uploadPublishingFile(api:string,file:File,kind:'audio'|'cover',signal:AbortSignal,
 onStage?:(message:string)=>void):Promise<number>{
 const limit=(kind==='audio'?150:15)*1024*1024;
 const mime=kind==='audio'?(/\.mp3$/i.test(file.name)?'audio/mpeg':/\.wav$/i.test(file.name)?'audio/wav':''):
  (/\.png$/i.test(file.name)?'image/png':/\.jpe?g$/i.test(file.name)?'image/jpeg':/\.webp$/i.test(file.name)?'image/webp':'');
 if(!mime||file.size<=0||file.size>limit)throw Error(kind==='audio'?'Use MP3/WAV up to 150 MiB':'Use PNG/JPEG/WEBP up to 15 MiB');
 if(!api)throw Error('Upload API is not configured');
 signal.throwIfAborted();
 const item=names[kind];
 onStage?.('Checking '+item+' file…');
 const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
 signal.throwIfAborted();
 const sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
 onStage?.('Starting '+item+' upload…');
 const response=await request('initializing',kind,signal,()=>fetch(api+'/api/library/files/init',{
  method:'POST',credentials:'include',signal,headers:{'Content-Type':'application/json'},
  body:JSON.stringify({kind,name:file.name,contentType:mime,size:file.size,sha256})
 }));
 const data=await response.json().catch(()=>null);
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('1CE upload API returned an invalid initialization response.');
 if(!response.ok)throw Error(typeof data.error==='string'?data.error:'Unable to start upload');
 const id=Number(data.id);if(!Number.isSafeInteger(id)||id<=0)throw Error('Invalid upload response');
 if(data.reused===true){onStage?.('Existing '+item+' verified.');return id;}
 if(typeof data.uploadUrl!=='string')throw Error('Missing signed storage URL');
 let signed:URL;
 try{signed=new URL(data.uploadUrl);}catch{throw Error('Invalid storage upload URL');}
 if(signed.protocol!=='https:'||!signed.hostname.endsWith('.r2.cloudflarestorage.com')||signed.username||signed.password||signed.hash)throw Error('Invalid storage upload URL');
 onStage?.('Sending '+item+' to secure storage…');
 const put=await request('transferring',kind,signal,()=>fetch(signed.href,{
  method:'PUT',signal,headers:{'Content-Type':mime},body:file
 }));
 if(!put.ok)throw Error('Cloudflare R2 rejected the '+item+' upload (HTTP '+put.status+'). Check signed upload expiry, bucket CORS and Content-Type.');
 onStage?.('Verifying '+item+' upload…');
 const done=await request('verifying',kind,signal,()=>fetch(api+'/api/library/files/'+id+'/complete',{
  method:'POST',credentials:'include',signal
 }));
 const result=await done.json().catch(()=>null);
 if(!result||typeof result!=='object'||Array.isArray(result))throw Error('1CE upload verification returned an invalid response. Review the current file state before retrying.');
 if(!done.ok)throw Error(typeof result.error==='string'?result.error:'Unable to finalize upload');
 if(Number(result.id)!==id)throw Error('Invalid completion response');
 onStage?.(item==='audio'?'Audio ready.':'Image ready.');
 return id;
}
