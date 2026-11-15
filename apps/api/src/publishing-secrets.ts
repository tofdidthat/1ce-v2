import {createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto';
export type PublishingConfig={clientId:string;clientSecret:string;redirectUri:string;webOrigin:string;encryptionSecret:string};
export function publishingConfig():PublishingConfig|null{
 if(!!process.env.YOUTUBE_CLIENT_ID!==!!process.env.YOUTUBE_CLIENT_SECRET)return null;
 const clientId=process.env.YOUTUBE_CLIENT_ID||process.env.GOOGLE_CLIENT_ID;
 const clientSecret=process.env.YOUTUBE_CLIENT_SECRET||process.env.GOOGLE_CLIENT_SECRET;
 const redirectUri=process.env.YOUTUBE_REDIRECT_URI||process.env.GOOGLE_REDIRECT_URI;
 const webOrigin=process.env.WEB_ORIGIN;
 const encryptionSecret=process.env.PUBLISH_TOKEN_KEY||clientSecret;
 if(!clientId||!clientSecret||!redirectUri||!webOrigin||!encryptionSecret||encryptionSecret.length<16)return null;
 try{if(new URL(redirectUri).protocol!=='https:'||new URL(webOrigin).protocol!=='https:')return null;}catch{return null;}
 return {clientId,clientSecret,redirectUri,webOrigin,encryptionSecret};
}
function key(secret:string):Buffer{
 if(secret.length<16)throw Error('Publishing encryption unavailable');
 return Buffer.from(hkdfSync('sha256',secret,'1ce-v2-publishing','aes-gcm-v1',32));
}
// Context binds ciphertext to its account and purpose, including checkpoint ID.
export function sealPublishing(value:string,context:string,secret:string):string{
 if(!value||value.length>16384)throw Error('Invalid publishing credential');
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),nonce);
 cipher.setAAD(Buffer.from(context));
 const bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return ['v1',nonce.toString('base64url'),cipher.getAuthTag().toString('base64url'),bytes.toString('base64url')].join('.');
}
export function openPublishing(value:string,context:string,secret:string):string{
 const parts=value.split('.');
 if(parts.length!==4||parts[0]!=='v1'||value.length>24000||parts.slice(1).some(x=>!/^[A-Za-z0-9_-]+$/.test(x)))throw Error('Invalid publishing credential');
 const nonce=Buffer.from(parts[1],'base64url'),tag=Buffer.from(parts[2],'base64url');
 if(nonce.length!==12||tag.length!==16)throw Error('Invalid publishing credential');
 const cipher=createDecipheriv('aes-256-gcm',key(secret),nonce);
 cipher.setAAD(Buffer.from(context));cipher.setAuthTag(tag);
 return Buffer.concat([cipher.update(Buffer.from(parts[3],'base64url')),cipher.final()]).toString('utf8');
}
