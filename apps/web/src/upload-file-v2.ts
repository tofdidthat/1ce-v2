export async function uploadPublishingFile(api:string,file:File,kind:'audio'|'cover',signal:AbortSignal):Promise<number>{
 const limit=(kind==='audio'?150:15)*1024*1024;
 const mime=kind==='audio'?(/\.mp3$/i.test(file.name)?'audio/mpeg':/\.wav$/i.test(file.name)?'audio/wav':''):
  (/\.png$/i.test(file.name)?'image/png':/\.jpe?g$/i.test(file.name)?'image/jpeg':/\.webp$/i.test(file.name)?'image/webp':'');
 if(!mime||file.size<=0||file.size>limit)throw Error(kind==='audio'?'Use MP3/WAV up to 150 MiB':'Use PNG/JPEG/WEBP up to 15 MiB');
 if(!api)throw Error('Upload API is not configured');
 const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
 signal.throwIfAborted();
 const sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
 const response=await fetch(api+'/api/library/files/init',{method:'POST',credentials:'include',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,name:file.name,contentType:mime,size:file.size,sha256})});
 const data=await response.json();
 if(!response.ok)throw Error(data.error||'Unable to start upload');
 const id=Number(data.id);if(!Number.isSafeInteger(id)||id<=0)throw Error('Invalid upload response');
 if(data.reused===true)return id;
 const signed=new URL(data.uploadUrl);
 if(signed.protocol!=='https:'||!signed.hostname.endsWith('.r2.cloudflarestorage.com')||signed.username||signed.password||signed.hash)throw Error('Invalid storage upload URL');
 const put=await fetch(signed.href,{method:'PUT',signal,headers:{'Content-Type':mime},body:file});
 if(!put.ok)throw Error('Storage upload failed');
 const done=await fetch(api+'/api/library/files/'+id+'/complete',{method:'POST',credentials:'include',signal});
 const result=await done.json();
 if(!done.ok)throw Error(result.error||'Unable to finalize upload');
 if(Number(result.id)!==id)throw Error('Invalid completion response');
 return id;
}
