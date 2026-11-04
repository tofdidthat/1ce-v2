// Browser read model for /api/public/profile/:identifier.
// Profile metadata is not proof of authorization to private project media.
import {isAccountUserV2,type AccountUserV2} from './account-identity-v2';

export type PublicProfileIdentityV2=AccountUserV2&{links?:string[]};

export function isPublicProfileIdentityV2(value:unknown):value is PublicProfileIdentityV2{
 if(!isAccountUserV2(value))return false;
 const record=value as Record<string,unknown>;
 return record.links===undefined||(Array.isArray(record.links)&&record.links.every(link=>typeof link==='string'));
}
