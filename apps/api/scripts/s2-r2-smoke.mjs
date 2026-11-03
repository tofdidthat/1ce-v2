// Opt-in S2 Cloudflare R2 compatibility probe. NEVER run on the production
// media bucket. Creates and deletes only its own random objects in a separate
// disposable test bucket named onece-s2-smoke-<suffix>.
import {randomUUID,createHash} from 'node:crypto';
import {
 S3Client,PutObjectCommand,HeadObjectCommand,CopyObjectCommand,
 GetObjectCommand,DeleteObjectCommand
} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';

const {R2_SMOKE_ACCOUNT_ID:account,R2_SMOKE_KEY_ID:key,
 R2_SMOKE_SECRET:secret,R2_SMOKE_BUCKET:bucket}=process.env;
if(!account||!key||!secret||!bucket||!/^onece-s2-smoke-[a-z0-9-]+$/.test(bucket))
 throw Error('Dedicated R2_SMOKE_* credentials and onece-s2-smoke-* bucket are REQUIRED');
if(process.env.R2_BUCKET_NAME===bucket)
 throw Error('Refusing to operate on the application media bucket');
const s3=new S3Client({region:'auto',
 endpoint:'https://'+account+'.r2.cloudflarestorage.com',
 credentials:{accessKeyId:key,secretAccessKey:secret},forcePathStyle:true});
const nonce=randomUUID(),prefix='s2-smoke/'+nonce+'/';
const staging=prefix+'staging.bin',final=prefix+'verified.bin',race=prefix+'raced.bin';
const payload=Buffer.from('1CE S2 isolated R2 signed PUT / CopyObject smoke '+nonce);
const overwritten=Buffer.alloc(payload.length,0x52); // preserve signed Content-Length
const uploaded=[];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(condition,message)=>{if(!condition)throw Error(message);};
const read=async key=>{
 const obj=await s3.send(new GetObjectCommand({Bucket:bucket,Key:key}));
 const chunks=[];
 for await(const chunk of obj.Body)chunks.push(Buffer.from(chunk));
 return Buffer.concat(chunks);
};
try{
 const signed=await getSignedUrl(s3,new PutObjectCommand({
  Bucket:bucket,Key:staging,ContentType:'application/octet-stream',ContentLength:payload.length
 }),{expiresIn:60});
 uploaded.push(staging);
 const sent=await fetch(signed,{method:'PUT',
  headers:{'Content-Type':'application/octet-stream'},body:payload,signal:AbortSignal.timeout(15000)});
 check(sent.ok,'Direct presigned PUT failed: '+sent.status);
 const head=await s3.send(new HeadObjectCommand({Bucket:bucket,Key:staging}));
 check(Number(head.ContentLength)===payload.length,'HEAD size mismatch');
 check(head.ContentType==='application/octet-stream','HEAD Content-Type mismatch');
 check(typeof head.ETag==='string','HEAD ETag missing');
 uploaded.push(final);
 await s3.send(new CopyObjectCommand({
  Bucket:bucket,Key:final,CopySource:bucket+'/'+staging,CopySourceIfMatch:head.ETag
 }));
 const range=await s3.send(new GetObjectCommand({Bucket:bucket,Key:final,Range:'bytes=0-15'}));
 const bytes=[];
 for await(const chunk of range.Body)bytes.push(Buffer.from(chunk));
 check(Buffer.concat(bytes).equals(payload.subarray(0,16)),'R2 ranged GET mismatch');
 check(digest(await read(final))===digest(payload),'Final CopyObject changed content');
 // Reusing a still-valid presigned URL MUST NOT change the final copy.
 const over=await fetch(signed,{method:'PUT',
  headers:{'Content-Type':'application/octet-stream'},body:overwritten,signal:AbortSignal.timeout(15000)});
 check(over.ok,'Staging overwrite smoke failed: '+over.status);
 check(digest(await read(final))===digest(payload),'SIGNED PUT MODIFIED IMMUTABLE FINAL OBJECT');
 // Source ETag must reject stale copy after the PUT replaced staging.
 let rejected=false;
 uploaded.push(race);
 try{
  await s3.send(new CopyObjectCommand({
   Bucket:bucket,Key:race,CopySource:bucket+'/'+staging,CopySourceIfMatch:head.ETag
  }));
 }catch(err){rejected=err?.$metadata?.httpStatusCode===412;}
 check(rejected,'R2 source CopySourceIfMatch did not reject stale ETag');
 console.log('S2 dedicated R2 smoke: PASS (signed PUT, HEAD, conditional CopyObject, range, overwrite isolation, stale ETag)');
}finally{
 for(const key of uploaded.reverse()){
  try{await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));}
  catch(err){console.error('S2 cleanup failed for generated object; review dedicated smoke bucket',key,err?.name);}
 }
 s3.destroy();
}
