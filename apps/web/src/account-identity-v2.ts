// Untrusted browser response validator; authorization remains in the API.
import type {AccountUserV2,PublicProfileUserV2} from '../../../packages/shared/contracts.js';
export type {AccountUserV2,PublicProfileUserV2} from '../../../packages/shared/contracts.js';
export function isAccountUserV2(value:unknown):value is AccountUserV2{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const user=value as Record<string,unknown>;
 if(typeof user.id!=='number'||!Number.isSafeInteger(user.id)||user.id<1)return false;
 for(const field of ['name','picture','username','avatar_updated_at']){
  const fieldValue=user[field];
  if(fieldValue!==undefined&&fieldValue!==null&&typeof fieldValue!=='string')return false;
 }
 if(user.email!==undefined&&typeof user.email!=='string')return false;
 if(user.has_avatar!==undefined&&typeof user.has_avatar!=='boolean')return false;
 return true;
}

export function isPublicProfileUserV2(value:unknown):value is PublicProfileUserV2{
 if(!isAccountUserV2(value))return false;
 const profile=value as unknown as Record<string,unknown>;
 if(typeof profile.has_avatar!=='boolean'||!Array.isArray(profile.links)||
    !profile.links.every(link=>typeof link==='string'))return false;
 for(const field of ['name','picture','username','avatar_updated_at']){
  if(!(field in profile)||profile[field]!==null&&typeof profile[field]!=='string')return false;
 }
 for(const field of ['displayName','handle']){
  if(profile[field]!==undefined&&profile[field]!==null&&typeof profile[field]!=='string')return false;
 }
 return true;
}
