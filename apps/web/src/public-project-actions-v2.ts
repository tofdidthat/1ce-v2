// Shared public project read and authorized MP3 download; no new API routes.
export type PlayableTrackV2={id:string;owner_id:number;title:string;audio_file_id:number;cover_file_id:number|null;stems_file_id:number|null};
export type PlayableProjectV2={id:string;owner_id:number;kind:'beat'|'pack';title:string;cover_file_id:number|null;tracks:PlayableTrackV2[]};
const api=import.meta.env.VITE_API_URL;
export async function fetchPlayableProjectV2(ownerId:number,kind:'beat'|'pack',id:string,signal?:AbortSignal):Promise<PlayableProjectV2>{
 if(!api||!Number.isSafeInteger(ownerId)||ownerId<1||!['beat','pack'].includes(kind)||!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid project');
 const response=await fetch(api+'/api/public/play/'+ownerId+'/'+kind+'/'+id,{credentials:'include',cache:'no-store',signal});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(payload.error||'Project not available');
 const project=payload.project;
 if(project?.owner_id!==ownerId||project.kind!==kind||project.id!==id||!Array.isArray(project.tracks))throw Error('Invalid project manifest');
 const tracks:PlayableTrackV2[]=project.tracks.map((t:any)=>({
  id:String(t.id),owner_id:Number(t.owner_id),title:String(t.title||'Untitled'),
  audio_file_id:Number(t.audio_file_id),cover_file_id:t.cover_file_id==null?null:Number(t.cover_file_id),
  stems_file_id:null
 }));
 if(!tracks.length||tracks.some(t=>t.owner_id!==ownerId||!Number.isSafeInteger(t.audio_file_id)||t.audio_file_id<1))throw Error('No playable tracks');
 return {id,kind,owner_id:ownerId,title:String(project.title||'Untitled'),cover_file_id:project.cover_file_id??null,tracks};
}
export function publicProjectLinkV2(origin:string,ownerId:number,kind:'beat'|'pack',id:string):string{
 if(!Number.isSafeInteger(ownerId)||ownerId<1||!['beat','pack'].includes(kind)||!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid project');
 // Public profile is the existing route. The query is navigation, not an access token.
 const url=new URL('/u/'+ownerId,origin);
 url.searchParams.set('project',kind+':'+id);
 return url.toString();
}
export function safeMp3NameV2(title:string):string{
 const cleaned=title.replace(/[\\/:*?"<>|\x00-\x1f]/g,'').replace(/[. ]+$/g,'').trim().slice(0,120);
 return (cleaned||'beat')+'.mp3';
}
export async function downloadAuthorizedMp3V2(track:PlayableTrackV2,signal?:AbortSignal):Promise<void>{
 if(!api||!Number.isSafeInteger(track.owner_id)||!Number.isSafeInteger(track.audio_file_id))throw Error('Invalid audio file');
 const response=await fetch(api+'/api/public/audio/'+track.owner_id+'/'+track.audio_file_id,{
  credentials:'include',cache:'no-store',signal
 });
 if(!response.ok)throw Error(response.status===404?'This audio is not available for download':'Unable to download MP3');
 const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(!['audio/mpeg','audio/mp3','audio/x-mpeg','audio/mpeg3','audio/x-mp3'].includes(mime)){
  await response.body?.cancel();
  throw Error('This project does not contain an MP3 file; conversion is not available');
 }
 const blob=await response.blob();
 if(!blob.size)throw Error('Empty audio file');
 if(signal?.aborted)throw Error('Download cancelled');
 const objectUrl=URL.createObjectURL(blob);
 try{
  const anchor=document.createElement('a');
  anchor.href=objectUrl;anchor.download=safeMp3NameV2(track.title);
  document.body.appendChild(anchor);anchor.click();anchor.remove();
 }finally{setTimeout(()=>URL.revokeObjectURL(objectUrl),30_000)}
}
