// Opt-in R2/DB orphan audit. Does not upload, delete or mutate objects.
import pg from 'pg';
import {S3Client,ListObjectsV2Command} from '@aws-sdk/client-s3';
import {auditVerifiedOrphans,validAuditPrefix} from '../dist/orphan-audit.js';

if(process.env.V2_ORPHAN_AUDIT_ENABLED!=='true')
 throw new Error('Explicit V2_ORPHAN_AUDIT_ENABLED=true required');
const prefix=process.env.V2_ORPHAN_AUDIT_PREFIX;
if(!validAuditPrefix(prefix))
 throw new Error('V2_ORPHAN_AUDIT_PREFIX must be users/ or users/<numeric-id>/');
const bucket=process.env.R2_BUCKET_NAME;
if(!bucket||process.env.V2_ORPHAN_AUDIT_CONFIRM_BUCKET!==bucket)
 throw new Error('Confirm exact v2 bucket with V2_ORPHAN_AUDIT_CONFIRM_BUCKET');
for(const name of ['DATABASE_URL','R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY'])
 if(!process.env[name])throw new Error('Missing v2 configuration: '+name);

const s3=new S3Client({
 region:'auto',
 endpoint:'https://'+process.env.R2_ACCOUNT_ID+'.r2.cloudflarestorage.com',
 credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,
  secretAccessKey:process.env.R2_SECRET_ACCESS_KEY},
 forcePathStyle:true
});
const pool=new pg.Pool({
 connectionString:process.env.DATABASE_URL,max:1,
 connectionTimeoutMillis:5000,statement_timeout:15000
});
try{
 const report=await auditVerifiedOrphans({
  prefix,
  listPage:async({prefix,continuationToken,maxKeys})=>s3.send(
   new ListObjectsV2Command({
    Bucket:bucket,Prefix:prefix,MaxKeys:maxKeys,
    ...(continuationToken?{ContinuationToken:continuationToken}:{})
   }),{abortSignal:AbortSignal.timeout(20000)}
  ),
  findReferences:async keys=>{
   const db=await pool.connect();
   try{
    await db.query('BEGIN READ ONLY');
    // Look at every status. Do NOT assume only ready rows reference storage.
    const q=await db.query('SELECT object_key FROM library_files WHERE object_key=ANY($1::text[])',[keys]);
    await db.query('COMMIT');
    return q.rows.map(row=>row.object_key);
   }catch(error){
    try{await db.query('ROLLBACK');}catch{}
    throw error;
   }finally{db.release();}
  }
 });
 // Output fingerprints only; no file keys, credentials or presigned URLs.
 console.log(JSON.stringify(report,null,2));
 if(!report.complete||report.suspectedOrphans>0)process.exitCode=2;
}finally{
 await pool.end();
 s3.destroy();
}
