import {parentPort,workerData} from 'node:worker_threads';
import {S3Client,GetObjectCommand} from '@aws-sdk/client-s3';
import {isR2ReadableBody} from './r2-body.js';
import {decodeWaveform} from './waveform-decode.js';

// Only trusted file metadata from the authorized database lookup enters this worker.
async function run():Promise<number[]>{
 const data:unknown=workerData;
 if(!data||typeof data!=='object')throw Error('Invalid job');
 const file=data as Record<string,unknown>;
 if(typeof file.key!=='string'||typeof file.bytes!=='number'||
  !Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>150*1024*1024||
  (file.sha256!==null&&(typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256)))||!['mp3','wav'].includes(String(file.format)))throw Error('Invalid job');
 const {R2_ACCOUNT_ID:account,R2_ACCESS_KEY_ID:key,R2_SECRET_ACCESS_KEY:secret,R2_BUCKET_NAME:bucket}=process.env;
 if(!account||!key||!secret||!bucket)throw Error('Storage unavailable');
 const s3=new S3Client({region:'auto',endpoint:'https://'+account+'.r2.cloudflarestorage.com',
  credentials:{accessKeyId:key,secretAccessKey:secret},forcePathStyle:true});
 const abort=AbortSignal.timeout(80000);
 const result=await s3.send(new GetObjectCommand({Bucket:bucket,Key:file.key}),{abortSignal:abort});
 if(!isR2ReadableBody(result.Body)){s3.destroy();throw Error('Invalid storage body');}
 const body=result.Body;
 try{
  return await decodeWaveform(body,file.format as 'mp3'|'wav',file.bytes,file.sha256 as string|null);
 }finally{body.destroy?.();s3.destroy();}
}
if(parentPort)run().then(bars=>parentPort!.postMessage({bars}),()=>parentPort!.postMessage({error:true}));

