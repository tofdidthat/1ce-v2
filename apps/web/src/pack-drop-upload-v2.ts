import type {DragEvent} from 'react';
import {uploadPublishingFile} from './upload-file-v2';

const api=import.meta.env.VITE_API_URL;
export function isAudioFileDrag(event:DragEvent):boolean{
 return Array.from(event.dataTransfer.types).includes('Files');
}
export async function addFilesToOwnedPack(packId:string,files:File[],signal:AbortSignal,onProgress:(message:string)=>void):Promise<{added:number;errors:string[]}>{
 if(!api)throw Error('Upload API is not configured');
 let added=0;const errors:string[]=[];
 for(const [index,file] of files.entries()){
  if(signal.aborted)break;
  if(!/\.(mp3|wav)$/i.test(file.name)){errors.push(file.name+': MP3 or WAV required');continue;}
  try{
   onProgress('Adding '+(index+1)+'/'+files.length+': '+file.name);
   const audioFileId=await uploadPublishingFile(api,file,'audio',signal,onProgress);
   const title=file.name.replace(/\.(mp3|wav)$/i,'').trim();
   const attached=await fetch(api+'/api/library/projects/pack/'+encodeURIComponent(packId)+'/audio',{
    method:'POST',credentials:'include',signal,headers:{'Content-Type':'application/json'},
    body:JSON.stringify({audioFileId,title})});
   const result=await attached.json().catch(()=>null);
   if(!attached.ok||!result||typeof result.added!=='number')throw Error(result?.error||'Unable to add beat to pack');
   added+=result.added;
  }catch(error){
   if(signal.aborted)break;
   errors.push(file.name+': '+(error instanceof Error?error.message:'Upload failed'));
  }
 }
 return {added,errors};
}
