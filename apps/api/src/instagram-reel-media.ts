import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {GetObjectCommand} from '@aws-sdk/client-s3';
import type {QueryableV2} from '../../../packages/shared/contracts.js';
import {publishingStorage,type PublishingStorage} from './publishing-storage.js';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const publicHeader={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'cross-origin'};
type Asset={artifact_key:string;artifact_bytes:number|string;artifact_sha:string;user_id:number|string};
export function validateInstagramRange(value:string|undefined,bytes:number):{start:number;end:number}|null{
 if(!value)return{start:0,end:bytes-1};
 if(value.length>90)return null;
 const match=/^bytes=(\d+)-(\d*)$/.exec(value);
 if(!match)return null;
 const start=Number(match[1]),end=match[2]?Number(match[2]):bytes-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=bytes)return null;
 return {start,end};
}
// Public-by-capability, not public by bucket: serves only an ephemeral rendered
// video, only after one explicit, owner-authorized public-reel job exists.
type MediaOptions={storage?:PublishingStorage|null};
export function serveInstagramReelMedia(req:IncomingMessage,res:ServerResponse,url:URL,db:QueryableV2,options:MediaOptions={}){
 return serveRenderedMedia(req,res,url,db,'instagram',options);
}
export function serveTikTokMedia(req:IncomingMessage,res:ServerResponse,url:URL,db:QueryableV2,options:MediaOptions={}){
 return serveRenderedMedia(req,res,url,db,'tiktok',options);
}
async function serveRenderedMedia(req:IncomingMessage,res:ServerResponse,url:URL,db:QueryableV2,
 provider:'instagram'|'tiktok',{storage=publishingStorage()}:MediaOptions):Promise<void>{
 const token=url.searchParams.get('token')||'';
 if(!['GET','HEAD'].includes(req.method||'')||[...url.searchParams.keys()].length!==1||
  !/^[A-Za-z0-9_-]{43}$/.test(token)){
  res.writeHead(404,publicHeader);res.end();return;
 }
 const row=(await db.query(provider==='tiktok'?`SELECT c.artifact_key,c.artifact_sha,c.artifact_bytes,j.user_id
  FROM v2_tiktok_checkpoints c JOIN v2_publication_targets t ON t.id=c.target_id
  JOIN v2_publication_jobs j ON j.id=t.job_id JOIN v2_tiktok_connections conn ON conn.user_id=j.user_id
  AND conn.generation=c.connection_generation WHERE c.token_hash=$1 AND c.expires_at>clock_timestamp()
  AND t.platform='tiktok' AND t.state IN ('running','retryable','needs_review') AND j.tiktok_preferences->>'consent'='true'
  AND conn.generation::text=j.tiktok_preferences->>'connectionId'
  AND c.artifact_key=concat('publishing/users/',j.user_id,'/',j.id,'/',t.id,'/',c.artifact_sha,'.mp4')`:`SELECT c.artifact_key,c.artifact_sha,c.artifact_bytes,j.user_id
  FROM v2_instagram_media_grants g
  JOIN v2_instagram_checkpoints c ON c.target_id=g.target_id
  JOIN v2_publication_targets t ON t.id=g.target_id
  JOIN v2_publication_jobs j ON j.id=t.job_id
  JOIN v2_instagram_connections ig ON ig.user_id=j.user_id AND ig.generation=c.connection_generation
  WHERE g.token_hash=$1 AND g.expires_at>clock_timestamp()
   AND t.platform='instagram' AND t.state='running' AND j.state='ready'
   AND j.instagram_public_confirmed=true AND j.instagram_generation=c.connection_generation
   AND c.publish_started_at IS NULL`,[sha(token)])).rows[0] as Asset|undefined;
 const bytes=Number(row?.artifact_bytes),key=String(row?.artifact_key||'');
 const owner=String(row?.user_id||'');
 const valid=!!row&&Number.isSafeInteger(bytes)&&bytes>0&&bytes<=256*1024*1024&&
  /^[0-9a-f]{64}$/.test(String(row.artifact_sha))&&
  /^\d+$/.test(owner)&&
  /^publishing\/users\/\d+\/[0-9a-f-]+\/\d+\/[0-9a-f]{64}\.mp4$/.test(key)&&
  key.startsWith('publishing/users/'+owner+'/')&&key.endsWith('/'+row.artifact_sha+'.mp4');
 if(!valid||!storage){res.writeHead(404,publicHeader);res.end();return;}
 const range=validateInstagramRange(typeof req.headers.range==='string'?req.headers.range:undefined,bytes);
 if(!range){res.writeHead(416,{...publicHeader,'Content-Range':'bytes */'+bytes});res.end();return;}
 const partial=range.start>0||range.end<bytes-1||!!req.headers.range;
 const headers:Record<string,string>={...publicHeader,'Content-Type':'video/mp4',
  'Content-Length':String(range.end-range.start+1),'Accept-Ranges':'bytes'};
 if(partial)headers['Content-Range']='bytes '+range.start+'-'+range.end+'/'+bytes;
 if(req.method==='HEAD'){res.writeHead(partial?206:200,headers);res.end();return;}
 try{
  const obj=await storage.s3.send(new GetObjectCommand({Bucket:storage.bucket,Key:key,
   ...(partial?{Range:'bytes='+range.start+'-'+range.end}:{})}),{abortSignal:AbortSignal.timeout(120000)});
  if(!obj.Body||!((obj.Body as Readable).pipe instanceof Function)||
   (obj.ContentLength!==undefined&&obj.ContentLength!==range.end-range.start+1))
   throw Error('Media body unavailable');
  res.writeHead(partial?206:200,headers);
  await pipeline(obj.Body as Readable,res);
 }catch{
  if(!res.headersSent){res.writeHead(502,publicHeader);res.end();}
  else res.destroy();
 }
}
