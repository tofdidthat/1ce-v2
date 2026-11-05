// Google OAuth responses are external JSON, not trusted TypeScript values.
// Require verified identity before creating or linking an account.
export type VerifiedGoogleV2={sub:string;email:string;email_verified:true;name?:string|null;picture?:string|null};
const record=(value:unknown):Record<string,unknown>|null=>
 value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const optionalText=(value:unknown):value is string|null|undefined=>
 value===null||value===undefined||typeof value==='string';

export function parseGoogleAccessToken(value:unknown):string{
 const token=record(value)?.access_token;
 if(typeof token!=='string'||!token)throw Error('Google access token missing');
 return token;
}
export function parseVerifiedGoogleUser(value:unknown):VerifiedGoogleV2{
 const user=record(value);
 const sub=user?.sub,email=user?.email,verified=user?.email_verified;
 const name=user?.name,picture=user?.picture;
 if(typeof sub!=='string'||!sub||typeof email!=='string'||verified!==true||
  !optionalText(name)||!optionalText(picture))
  throw Error('Google identity not verified');
 return {sub,email,email_verified:true,name,picture};
}
