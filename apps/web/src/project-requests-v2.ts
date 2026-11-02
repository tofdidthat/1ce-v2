// One lightweight HTTP mutation layer for projects. View-specific UI state and
// navigation remain in their callers until the centralized store phase.
export type ProjectKindV2='beat'|'pack';
const api=import.meta.env.VITE_API_URL;

async function projectMutation(path:string,method:'POST'|'DELETE',fallback:string){
 if(!api)throw Error('API is not configured');
 const response=await fetch(api+path,{method,credentials:'include'});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(payload.error||fallback);
 return payload;
}

export async function setProjectPublishedV2(kind:ProjectKindV2,id:string,alreadyPublished:boolean){
 await projectMutation('/api/public/publish/'+kind+'/'+id,alreadyPublished?'DELETE':'POST','Unable to update publication');
}

export async function setProjectSavedV2(ownerId:number,kind:ProjectKindV2,id:string,alreadySaved:boolean){
 await projectMutation('/api/public/save/'+ownerId+'/'+kind+'/'+id,alreadySaved?'DELETE':'POST','Unable to save');
}

export async function createProjectShareLinkV2(kind:ProjectKindV2,id:string):Promise<string>{
 const result=await projectMutation('/api/public/share/'+kind+'/'+id,'POST','Unable to create share link');
 if(typeof result.token!=='string'||!result.token)throw Error('Share link was not returned');
 return window.location.origin+'/shared/'+result.token;
}
