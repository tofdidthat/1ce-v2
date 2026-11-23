import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {QueryableV2} from '../../../packages/shared/contracts.js';
import {deletionCodeHash,scheduleInstagramDataDeletion} from './instagram-data-deletion.js';

type CompliancePool=QueryableV2&{connect():Promise<QueryableV2&{release():void}>};
type MetaAction='deauthorize'|'data-deletion';
type MetaConfig={appSecret:string;webOrigin:string};
const subjectHash=(metaUserId:string)=>createHash('sha256').update('instagram-meta-subject:'+metaUserId).digest('hex');
const json=(res:ServerResponse,status:number,value:unknown)=>{
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
 res.end(JSON.stringify(value));
};
export function instagramMetaConfig(env=process.env):MetaConfig|null{
 if(env.INSTAGRAM_META_CUTOVER_APPROVED!=='true')return null;
 const {INSTAGRAM_CLIENT_SECRET,INSTAGRAM_APP_SECRET,WEB_ORIGIN}=env;
 if(INSTAGRAM_CLIENT_SECRET&&INSTAGRAM_APP_SECRET&&INSTAGRAM_CLIENT_SECRET!==INSTAGRAM_APP_SECRET)return null;
 const appSecret=INSTAGRAM_CLIENT_SECRET||INSTAGRAM_APP_SECRET;
 if(!appSecret||appSecret.length<16||!WEB_ORIGIN)return null;
 try{
  const web=new URL(WEB_ORIGIN);
  if(web.protocol!=='https:'||web.pathname!=='/'||web.search||web.hash||web.username||web.password)return null;
  return {appSecret,webOrigin:web.origin};
 }catch{return null;}
}
function decodeBase64Url(value:string):Buffer{
 if(!/^[A-Za-z0-9_-]+$/.test(value))throw Error('Malformed Meta signature');
 const decoded=Buffer.from(value,'base64url');
 // Node accepts nonzero unused trailing bits. Reject alternate spellings of
 // the same signature, which would otherwise create a fresh replay receipt.
 if(decoded.toString('base64url')!==value)throw Error('Malformed Meta signature');
 return decoded;
}
export function parseMetaSignedRequest(value:string,appSecret:string):{userId:string}{
 if(value.length>12000||!appSecret||appSecret.length<16)throw Error('Invalid Meta signed request');
 const separator=value.indexOf('.');
 if(separator<1||separator===value.length-1||value.indexOf('.',separator+1)!==-1)throw Error('Malformed Meta signature');
 const signaturePart=value.slice(0,separator),payloadPart=value.slice(separator+1);
 const received=decodeBase64Url(signaturePart),expected=createHmac('sha256',appSecret).update(payloadPart).digest();
 if(received.length!==expected.length||!timingSafeEqual(received,expected))throw Error('Invalid Meta signature');
 const payloadText=decodeBase64Url(payloadPart).toString('utf8');
 // Preserve large decimal Meta IDs exactly rather than rounding through JS Number.
 const normalized=payloadText.replace(/("user_id"\s*:\s*)(\d+)(?=\s*[,}])/,'$1"$2"');
 let payload:unknown;
 try{payload=JSON.parse(normalized)}catch{throw Error('Invalid Meta payload');}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('Invalid Meta payload');
 const data=payload as Record<string,unknown>;
 if(String(data.algorithm||'').toUpperCase()!=='HMAC-SHA256')throw Error('Unsupported Meta signature algorithm');
 const userId=typeof data.user_id==='string'?data.user_id:'';
 if(!/^[0-9]{1,32}$/.test(userId))throw Error('Invalid Meta user id');
 return {userId};
}
async function signedRequestBody(req:IncomingMessage):Promise<string>{
 const parts:Buffer[]=[];let length=0;
 for await(const part of req){const chunk=Buffer.isBuffer(part)?part:Buffer.from(part);length+=chunk.length;
  if(length>16384)throw Error('Meta callback body too large');parts.push(chunk);}
 const raw=Buffer.concat(parts).toString('utf8');
 if((req.headers['content-type']||'').split(';')[0].trim().toLowerCase()==='application/json'){
  let body:unknown;try{body=JSON.parse(raw)}catch{throw Error('Invalid Meta callback body');}
  const signed=body&&typeof body==='object'&&!Array.isArray(body)?(body as Record<string,unknown>).signed_request:null;
  if(typeof signed!=='string')throw Error('Missing Meta signed request');
  return signed;
 }
 const params=new URLSearchParams(raw),signed=params.get('signed_request');
 if(!signed||params.getAll('signed_request').length!==1||[...params.keys()].some(key=>key!=='signed_request'))throw Error('Missing Meta signed request');
 return signed;
}
async function revokeV2Connection(client:QueryableV2,metaUserId:string):Promise<boolean>{
  const found=await client.query(`SELECT user_id,generation FROM v2_instagram_connections
   WHERE instagram_user_id=$1 ORDER BY user_id`,[metaUserId]);
  if(!found.rowCount)return !!(await client.query(`SELECT 1 FROM v2_instagram_compliance_subjects
   WHERE instagram_user_id_hash=$1 LIMIT 1`,[subjectHash(metaUserId)])).rowCount;
  const owners=found.rows.map(row=>Number(row.user_id)).filter(Number.isSafeInteger);
  for(const owner of owners){
   await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[owner]);
   const current=await client.query(`SELECT user_id FROM v2_instagram_connections
    WHERE user_id=$1 AND instagram_user_id=$2 FOR UPDATE`,[owner,metaUserId]);
   if(!current.rowCount)continue;
   await client.query(`INSERT INTO v2_instagram_compliance_subjects(user_id,instagram_user_id_hash)
    VALUES($1,$2) ON CONFLICT(user_id,instagram_user_id_hash) DO NOTHING`,[owner,subjectHash(metaUserId)]);
   await client.query('DELETE FROM v2_instagram_oauth WHERE user_id=$1',[owner]);
   await client.query(`UPDATE v2_publication_targets t SET state='needs_review',claim_token=NULL,claim_until=NULL,
    last_error_code='instagram_authorization_revoked',updated_at=clock_timestamp()
    FROM v2_publication_jobs j,v2_instagram_connections c
    WHERE j.id=t.job_id AND c.user_id=j.user_id AND c.user_id=$1 AND j.instagram_generation=c.generation
     AND t.platform='instagram' AND t.state IN ('queued','retryable','running')`,[owner]);
   await client.query('DELETE FROM v2_instagram_connections WHERE user_id=$1 AND instagram_user_id=$2',[owner,metaUserId]);
  }
  return true;
}
export async function handleInstagramMetaCompliance(req:IncomingMessage,res:ServerResponse,url:URL,db:CompliancePool,
 config:MetaConfig|null):Promise<void>{
 if(req.method!=='POST'){res.setHeader('Allow','POST');json(res,405,{error:'method_not_allowed'});return;}
 if([...url.searchParams.keys()].some(key=>key!=='action')||url.searchParams.getAll('action').length>1||
  (url.searchParams.has('action')&&!['deauthorize','data-deletion'].includes(url.searchParams.get('action')||''))){
  json(res,400,{error:'invalid_meta_callback'});return;
 }
 const action:MetaAction=url.searchParams.get('action')==='data-deletion'?'data-deletion':'deauthorize';
 let signedRequest:string;
 try{
  signedRequest=await signedRequestBody(req);
 }catch{
  json(res,400,{error:'invalid_meta_callback'});
  return;
 }
 if(!config){json(res,503,{error:'v2_compliance_unavailable'});return;}
 let userId:string;
 try{userId=parseMetaSignedRequest(signedRequest,config.appSecret).userId;}
 catch{json(res,400,{error:'invalid_meta_callback'});return;}
 let client:Awaited<ReturnType<CompliancePool['connect']>>|undefined;
 try{
  client=await db.connect();await client.query('BEGIN');
  // Serialize re-deliveries without storing the signed request or user ID.
  // A receipt also stops a delayed retry from revoking a later reconnection.
  const requestHash=createHash('sha256').update(action+':'+signedRequest).digest('hex');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[requestHash]);
  const receipt=(await client.query('SELECT legacy_response,v2_only FROM v2_instagram_compliance_receipts WHERE request_hash=$1',[requestHash])).rows[0];
  if(receipt&&!receipt.v2_only&&!receipt.legacy_response){
   await client.query('ROLLBACK');
   json(res,503,{error:'legacy_compliance_pending'});return;
  }
  const confirmationCode=createHmac('sha256',config.appSecret).update('meta-v2-deletion:'+requestHash).digest('hex').slice(0,32);
  if(!receipt){
   await client.query('INSERT INTO v2_instagram_compliance_receipts(request_hash,action,v2_only) VALUES($1,$2,true)',[requestHash,action]);
   const identified=action==='deauthorize'?await revokeV2Connection(client,userId):
    await scheduleInstagramDataDeletion(client,requestHash,confirmationCode,subjectHash(userId),userId)===true;
   if(!identified){
    await client.query('ROLLBACK');
    json(res,503,{error:'instagram_compliance_identity_unresolved'});return;
   }
  }
  if(action==='data-deletion'&&receipt){
   const existing=await client.query(`SELECT 1 FROM v2_instagram_data_deletions
    WHERE request_hash=$1 AND confirmation_hash=$2`,[requestHash,deletionCodeHash(confirmationCode)]);
   if(!existing.rowCount){
    await client.query('ROLLBACK');
    json(res,503,{error:'instagram_compliance_receipt_unresolved'});return;
   }
  }
  await client.query('COMMIT');
  if(action==='deauthorize'){json(res,200,{success:true});return;}
  const status=new URL('/api/instagram/data-deletion-status',config.webOrigin);
  status.searchParams.set('code',confirmationCode);
  json(res,200,{url:status.href,confirmation_code:confirmationCode});
 }catch{
  if(client)try{await client.query('ROLLBACK')}catch{}
  json(res,503,{error:'v2_compliance_unavailable'});return;
 }finally{client?.release();}
}
