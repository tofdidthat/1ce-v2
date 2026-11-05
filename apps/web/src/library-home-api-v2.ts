// API read boundary for Home and pack membership. No state, caching, writes or
// authorization shortcuts: the server remains authoritative for every item.
// This file intentionally does NOT normalize until the caller validates its
// current viewer; a stale account must never render the previous user's Home.
import {normalizePackTracksV2,type LibraryPackV2} from './project-read-v2';
const api=import.meta.env.VITE_API_URL;

export async function fetchLibraryHomePayloadV2(signal:AbortSignal){
 const response=await fetch(api+'/api/library/files/items',{credentials:'include',cache:'no-store',signal});
 const body=await response.json().catch(()=>({}));
 return {ok:response.ok,status:response.status,body};
}

export async function fetchLibraryPackTracksV2(
 pack:LibraryPackV2,signal?:AbortSignal,message='Unable to load pack'
){
 const response=await fetch(api+'/api/library/files/pack-tracks/'+pack.id,{credentials:'include',...(signal?{signal}:{})});
 if(!response.ok)throw Error(message);
 return normalizePackTracksV2(await response.json(),pack);
}
