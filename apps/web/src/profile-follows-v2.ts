// Public relationship metadata + session-authorized Follow actions.
// Does not grant playback, expose sessions, or alter project saves/publication.
const api=import.meta.env.VITE_API_URL;

export type FollowedAccountV2={
 id:number;username:string|null;name:string|null;picture:string|null;
 has_avatar:boolean;avatar_updated_at:string|null;
};
export type ProfileFollowsV2={
 followersCount:number;followingCount:number;viewerFollows:boolean;
 followingUsers:FollowedAccountV2[];
};
export type FollowMutationV2={ok:boolean;viewerFollows:boolean;followersCount:number};

function profileId(id:number){
 if(!Number.isSafeInteger(id)||id<1)throw Error('Invalid profile');
 return String(id);
}
async function responseJson<T>(response:Response,fallback:string):Promise<T>{
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||fallback);
 return result as T;
}
export async function getProfileFollowsV2(id:number,signal?:AbortSignal){
 if(!api)throw Error('API is not configured');
 const result=await fetch(api+'/api/public/follows/'+profileId(id),{credentials:'include',cache:'no-store',signal});
 return responseJson<ProfileFollowsV2>(result,'Unable to load following');
}
export async function setProfileFollowV2(id:number,alreadyFollowing:boolean){
 if(!api)throw Error('API is not configured');
 const result=await fetch(api+'/api/public/follows/'+profileId(id),{
  method:alreadyFollowing?'DELETE':'POST',credentials:'include',cache:'no-store'
 });
 return responseJson<FollowMutationV2>(result,'Unable to update follow');
}
