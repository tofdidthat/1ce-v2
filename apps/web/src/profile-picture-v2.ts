// Build the public avatar route from the current v2 API base; never expose R2 object keys.
import type {AccountUserV2} from '../../../packages/shared/contracts.js';
type AvatarSubjectV2=Pick<AccountUserV2,'id'|'picture'|'has_avatar'|'avatar_updated_at'>;
export function profilePictureV2(user:AvatarSubjectV2|null|undefined):string {
 if (!user) return '';
 if (user.has_avatar && user.id) {
  const api = import.meta.env.VITE_API_URL;
  if (api) return api + '/api/public/avatar/' + encodeURIComponent(String(user.id))
   + '?v=' + encodeURIComponent(String(user.avatar_updated_at || '1'));
 }
 return typeof user.picture === 'string' ? user.picture : '';
}
