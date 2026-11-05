// Owner downloads use the existing verified R2 files; packs are assembled in-browser.
// Original file IDs remain in the API/database, and no new media objects are created.
import {safeZipSegmentV2,saveBlobV2,zipArchiveV2,type ZipEntryV2} from './zip-archive-v2';
const api=import.meta.env.VITE_API_URL;
type OwnedBeatFilesV2={id:string;title:string;audio_file_id:number;stems_file_id:number|null};
export type OwnedProjectV2={kind:'beat'|'pack';id:string;title:string};
function fileId(value:unknown):number|null{
 if(typeof value!=='string'&&typeof value!=='number')return null;
 if(typeof value==='string'&&!/^[1-9]\d*$/.test(value))return null;
 const n=Number(value);
 return Number.isSafeInteger(n)&&n>0?n:null;
}
function decodeBeat(value:unknown):OwnedBeatFilesV2{
 const row=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
 const audio=fileId(row?.audio_file_id);
 const stems=row?.stems_file_id==null?null:fileId(row.stems_file_id);
 if(!row||typeof row.id!=='string'||typeof row.title!=='string'||!audio||
  (row.stems_file_id!=null&&!stems))throw Error('Invalid beat file metadata');
 return {id:row.id,title:row.title,audio_file_id:audio,stems_file_id:stems};
}
async function apiJson(path:string,signal?:AbortSignal):Promise<Record<string,unknown>>{
 if(!api)throw Error('API is not configured');
 const response=await fetch(api+path,{credentials:'include',cache:'no-store',signal});
 const payload:unknown=await response.json().catch(()=>null);
 if(!response.ok)throw Error(response.status===404?'Project not found or not owned by you':'Unable to load original project files');
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('Invalid project response');
 return payload as Record<string,unknown>;
}
export async function ownedBeatFilesV2(id:string,signal?:AbortSignal):Promise<OwnedBeatFilesV2>{
 const payload=await apiJson('/api/library/files/beat/'+encodeURIComponent(id),signal);
 return decodeBeat(payload.beat);
}
async function packBeats(id:string,signal?:AbortSignal):Promise<OwnedBeatFilesV2[]>{
 const payload=await apiJson('/api/library/files/pack-tracks/'+encodeURIComponent(id),signal);
 if(!Array.isArray(payload.beats)||payload.beats.length<1||payload.beats.length>100)throw Error('Pack is empty or unavailable');
 return payload.beats.map(decodeBeat);
}
async function media(id:number,kind:'audio'|'stems',signal?:AbortSignal):Promise<{blob:Blob;extension:string}>{
 if(!api)throw Error('API is not configured');
 const response=await fetch(api+'/api/library/files/'+kind+'/'+id,{credentials:'include',cache:'no-store',signal});
 if(!response.ok)throw Error(response.status===404?'The original '+kind+' file is unavailable':'Unable to download '+kind);
 const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 const extension=kind==='stems'?'zip':mime==='audio/wav'||mime==='audio/x-wav'||mime==='audio/wave'?'wav':
  ['audio/mpeg','audio/mp3','audio/x-mpeg','audio/mpeg3','audio/x-mp3'].includes(mime)?'mp3':null;
 if(!extension||(kind==='stems'&&!['application/zip','application/x-zip-compressed'].includes(mime))){
  await response.body?.cancel();throw Error('Unsupported original file type');
 }
 const length=Number(response.headers.get('content-length')||0);
 if(Number.isFinite(length)&&length>750*1024*1024){await response.body?.cancel();throw Error('File is too large to download in the browser');}
 const blob=await response.blob();
 if(!blob.size)throw Error('Original file is empty');
 if(signal?.aborted)throw new DOMException('Download cancelled','AbortError');
 return {blob,extension};
}
export async function downloadOwnedStemsV2(stemsFileId:number,beatTitle:string,signal?:AbortSignal):Promise<void>{
 const file=await media(stemsFileId,'stems',signal);
 saveBlobV2(file.blob,safeZipSegmentV2(beatTitle)+' - stems.zip');
}
export async function downloadOwnedProjectV2(project:OwnedProjectV2,signal?:AbortSignal,onProgress?:(message:string)=>void):Promise<void>{
 if(project.kind==='beat'){
  onProgress?.('Loading original beat…');
  const beat=await ownedBeatFilesV2(project.id,signal);
  const file=await media(beat.audio_file_id,'audio',signal);
  saveBlobV2(file.blob,safeZipSegmentV2(beat.title)+'.'+file.extension);
  return;
 }
 onProgress?.('Loading original pack…');
 const beats=await packBeats(project.id,signal);
 const folder=safeZipSegmentV2(project.title);
 const entries:ZipEntryV2[]=[];
 let bytes=0;
 for(const [index,beat] of beats.entries()){
  if(signal?.aborted)throw new DOMException('Download cancelled','AbortError');
  const label=String(index+1).padStart(2,'0')+' - '+safeZipSegmentV2(beat.title);
  onProgress?.('Downloading '+(index+1)+'/'+beats.length+'…');
  const audio=await media(beat.audio_file_id,'audio',signal);
  bytes+=audio.blob.size;
  if(bytes>750*1024*1024)throw Error('Pack exceeds 750 MB. Download tracks individually.');
  entries.push({name:folder+'/'+label+'.'+audio.extension,body:audio.blob});
  if(beat.stems_file_id){
   const stems=await media(beat.stems_file_id,'stems',signal);
   bytes+=stems.blob.size;
   if(bytes>750*1024*1024)throw Error('Pack exceeds 750 MB. Download tracks individually.');
   entries.push({name:folder+'/stems/'+label+'.zip',body:stems.blob});
  }
 }
 onProgress?.('Building pack ZIP…');
 const archive=await zipArchiveV2(entries,signal);
 saveBlobV2(archive,folder+'.zip');
}
