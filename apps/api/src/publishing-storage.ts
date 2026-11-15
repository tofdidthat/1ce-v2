import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {S3Client,GetObjectCommand} from '@aws-sdk/client-s3';
import {isR2ReadableBody} from './r2-body.js';
import {PublishingError} from './youtube-connection.js';
export type PublishingStorage={s3:S3Client;bucket:string};
export function publishingStorage():PublishingStorage|null{
 const {R2_ACCOUNT_ID:account,R2_ACCESS_KEY_ID:key,R2_SECRET_ACCESS_KEY:secret,R2_BUCKET_NAME:bucket}=process.env;
 if(!account||!key||!secret||!bucket)return null;
 return {bucket,s3:new S3Client({region:'auto',endpoint:'https://'+account+'.r2.cloudflarestorage.com',
  credentials:{accessKeyId:key,secretAccessKey:secret},forcePathStyle:true})};
}
export async function downloadPublishingAsset(storage:PublishingStorage,key:string,path:string,bytes:number,sha:string|null,signal:AbortSignal):Promise<void>{
 if(!Number.isSafeInteger(bytes)||bytes<1||bytes>256*1024*1024)throw new PublishingError('asset_size_invalid',422);
 const deadline=AbortSignal.any([signal,AbortSignal.timeout(180000)]);
 const object=await storage.s3.send(new GetObjectCommand({Bucket:storage.bucket,Key:key}),{abortSignal:deadline});
 if(!isR2ReadableBody(object.Body))throw new PublishingError('asset_unavailable',503);
 const file=await open(path,'wx',0o600),hash=createHash('sha256');let length=0;
 try{
  for await(const chunk of object.Body){
   deadline.throwIfAborted();length+=chunk.length;
   if(length>bytes)throw new PublishingError('asset_integrity_failed',422);
   hash.update(chunk);await file.writeFile(chunk);
  }
  if(length!==bytes||(sha!==null&&hash.digest('hex')!==sha))throw new PublishingError('asset_integrity_failed',422);
 }finally{await file.close();object.Body.destroy?.();}
}
export async function hashPublishingFile(path:string):Promise<string>{
 const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');
}
