import type {IncomingMessage,ServerResponse} from 'node:http';
import {publishingConfig,openPublishing,type PublishingConfig} from './publishing-secrets.js';
import {beginYouTubeConnection,startYouTubeConnection,finishYouTubeConnection,disconnectYouTube,PublishingError} from './youtube-connection.js';
import {publicationRendererAvailable} from './publication-renderer.js';
import {instagramConfig,instagramCallbackPath,beginInstagramConnection,startInstagramConnection,
 finishInstagramConnection,instagramConnectionStatus,disconnectInstagram,type InstagramConfig} from './instagram-connection.js';
import {ensurePublishingSchema} from './publishing-schema.js';
import {serveInstagramReelMedia} from './instagram-reel-media.js';
import {instagramReelsServerEnabled} from './instagram-reels-worker.js';
import {handleInstagramMetaCompliance} from './instagram-meta-compliance.js';
import {serveInstagramDataDeletionStatus} from './instagram-data-deletion.js';
import {enqueuePublication,listPublications,retryPublication,type PublishingPool} from './publishing-jobs.js';
import {tiktokConfig,tiktokCallbackPath,beginTikTokConnection,startTikTokConnection,
 finishTikTokConnection,tiktokConnectionStatus,disconnectTikTok,type TikTokConfig} from './tiktok-connection.js';
const send=(res:ServerResponse,status:number,value:unknown,headers:Record<string,string>={})=>{
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',...headers});res.end(JSON.stringify(value));
};
async function body(req:IncomingMessage):Promise<unknown>{
 const chunks:Buffer[]=[];let bytes=0;
 for await(const part of req){const chunk=Buffer.isBuffer(part)?part:Buffer.from(part);bytes+=chunk.length;
  if(bytes>16384)throw new PublishingError('request_too_large',413);chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{throw new PublishingError('invalid_json');}
}
type Options={config?:PublishingConfig|null;instagram?:InstagramConfig|null;tiktok?:TikTokConfig|null;renderer?:()=>boolean;http?:typeof fetch};
export async function handlePublishing(req:IncomingMessage,res:ServerResponse,pathname:string,db:PublishingPool,
 currentUser:(req:IncomingMessage)=>Promise<{id:number}|null>,{config=publishingConfig(),instagram=instagramConfig(),tiktok=tiktokConfig(),renderer=publicationRendererAvailable,http=fetch}:Options={}
):Promise<boolean>{
 const url=new URL(req.url||pathname,'https://api.invalid');
 const callback=!!config&&pathname===new URL(config.redirectUri).pathname&&(url.searchParams.get('state')||'').startsWith('pub_');
 const start=pathname==='/auth/youtube/start';
 const instagramCallback=!!instagram&&pathname===instagramCallbackPath(instagram);
 const instagramStart=pathname==='/auth/instagram/start';
 const tiktokCallback=!!tiktok&&pathname===tiktokCallbackPath(tiktok);
 const tiktokStart=pathname==='/auth/tiktok/start';
 const metaCompliance=pathname==='/api/instagram/meta-compliance';
 const deletionStatus=pathname==='/api/instagram/data-deletion-status';
 if(!callback&&!start&&!instagramCallback&&!instagramStart&&!tiktokCallback&&!tiktokStart&&!metaCompliance&&!deletionStatus&&!pathname.startsWith('/api/publishing/'))return false;
 try{
  if(deletionStatus){
   await ensurePublishingSchema(db);await serveInstagramDataDeletionStatus(req,res,url,db);return true;
  }
  if(metaCompliance){
   await ensurePublishingSchema(db);
   await handleInstagramMetaCompliance(req,res,url,db,instagram,{http});return true;
  }
  if(callback&&req.method==='GET'){
   const current=await currentUser(req);
   await ensurePublishingSchema(db);await finishYouTubeConnection(req,res,url,db,config!,current?.id??null,http);return true;
  }
  if(instagramCallback&&req.method==='GET'){
   const current=await currentUser(req);
   await ensurePublishingSchema(db);
   await finishInstagramConnection(req,res,url,db,instagram!,current?.id??null,http);return true;
  }
  if(tiktokCallback&&req.method==='GET'){
   const current=await currentUser(req);
   await ensurePublishingSchema(db);
   await finishTikTokConnection(req,res,url,db,tiktok!,current?.id??null,http);return true;
  }
  if(pathname==='/api/publishing/meta-media'){
   // Meta's video fetch cannot send a 1CE session cookie. It receives only
   // a short-lived hash-checked capability for one rendered output MP4.
   if(!instagram||!instagramReelsServerEnabled()){send(res,404,{error:'not_found'});return true;}
   await ensurePublishingSchema(db);
   await serveInstagramReelMedia(req,res,url,db);return true;
  }
  const user=await currentUser(req);
  if(!user){send(res,401,{error:'not_authenticated'});return true;}
  if(start&&req.method==='GET'&&config){
   await ensurePublishingSchema(db);
   const result=await startYouTubeConnection(db,user.id,url.searchParams.get('state')||'',config);
   // SameSite=Lax cookies are set on top-level navigation, never cross-site fetch.
   res.writeHead(302,{'Location':result.url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':result.cookie});res.end();return true;
  }
  if(instagramStart&&req.method==='GET'&&instagram){
   await ensurePublishingSchema(db);
   const result=await startInstagramConnection(db,user.id,url.searchParams.get('state')||'',instagram);
   res.writeHead(302,{'Location':result.url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':result.cookie});res.end();return true;
  }
  if(tiktokStart&&req.method==='GET'&&tiktok){
   await ensurePublishingSchema(db);
   const result=await startTikTokConnection(db,user.id,url.searchParams.get('state')||'',tiktok);
   res.writeHead(302,{'Location':result.url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':result.cookie});res.end();return true;
  }
  if(!['GET','POST'].includes(req.method||'')){send(res,405,{error:'method_not_allowed'});return true;}
  // Cookie-authenticated publishing mutations require the exact web origin,
  // even when called outside the global router in request-level tests.
  if(req.method==='POST'&&(!config&&!instagram&&!tiktok||req.headers.origin!==(config?.webOrigin||instagram?.webOrigin||tiktok?.webOrigin))){
   send(res,config||instagram||tiktok?403:503,{error:config||instagram||tiktok?'origin_not_allowed':'publishing_unavailable'});return true;
  }

  if(pathname==='/api/publishing/status'&&req.method==='GET'){
   if(!config&&!instagram&&!tiktok){send(res,200,{available:false,connected:false,tiktok:{available:false,connected:false,publishingEnabled:false},jobs:[]});return true;}
   await ensurePublishingSchema(db);
   let connection:Record<string,unknown>|undefined;
   if(config){
    connection=(await db.query('SELECT channel_title,refresh_cipher FROM v2_youtube_connections WHERE user_id=$1',[user.id])).rows[0];
    if(connection){try{openPublishing(String(connection.refresh_cipher),'youtube-refresh:'+user.id,config.encryptionSecret)}catch{connection=undefined;}}
   }
   const storage=!!(process.env.R2_ACCOUNT_ID&&process.env.R2_ACCESS_KEY_ID&&process.env.R2_SECRET_ACCESS_KEY&&process.env.R2_BUCKET_NAME);
   const instagramStatus=await instagramConnectionStatus(db,user.id,instagram);
   const reelsEnabled=instagramStatus.connected&&storage&&renderer()&&instagramReelsServerEnabled();
   send(res,200,{available:!!config&&storage&&renderer(),connected:!!connection,
    channelTitle:connection?String(connection.channel_title):null,
    instagram:{...instagramStatus,publishingEnabled:!!reelsEnabled},
    tiktok:await tiktokConnectionStatus(db,user.id,tiktok),jobs:await listPublications(db,user.id)});return true;
  }
  if(req.method==='POST'&&pathname==='/api/publishing/instagram/connect'){
   if(!instagram)throw new PublishingError('instagram_not_configured',503);
   await ensurePublishingSchema(db);await body(req);
   send(res,200,await beginInstagramConnection(db,user.id,instagram));return true;
  }
  if(req.method==='POST'&&pathname==='/api/publishing/instagram/disconnect'){
   if(!instagram)throw new PublishingError('instagram_not_configured',503);
   await ensurePublishingSchema(db);await body(req);
   await disconnectInstagram(db,user.id);send(res,200,{ok:true});return true;
  }
  if(req.method==='POST'&&pathname==='/api/publishing/tiktok/connect'){
   if(!tiktok)throw new PublishingError('tiktok_not_configured',503);
   await ensurePublishingSchema(db);await body(req);
   send(res,200,await beginTikTokConnection(db,user.id,tiktok));return true;
  }
  if(req.method==='POST'&&pathname==='/api/publishing/tiktok/disconnect'){
   if(!tiktok)throw new PublishingError('tiktok_not_configured',503);
   await ensurePublishingSchema(db);await body(req);
   send(res,200,await disconnectTikTok(db,user.id,tiktok,http));return true;
  }
  if(!config&&pathname!=='/api/publishing/jobs'&&
    !/^\/api\/publishing\/targets\/[1-9]\d*\/retry$/.test(pathname)){
   send(res,503,{error:'youtube_not_configured'});return true;
  }
  await ensurePublishingSchema(db);
  if(req.method==='POST'&&pathname==='/api/publishing/youtube/connect'){
   if(!config)throw new PublishingError('youtube_not_configured',503);
   await body(req);
   const result=await beginYouTubeConnection(db,user.id,config);
   send(res,200,{url:result.url});return true;
  }
  if(req.method==='POST'&&pathname==='/api/publishing/youtube/disconnect'){
   if(!config)throw new PublishingError('youtube_not_configured',503);
   await body(req);await disconnectYouTube(db,user.id,config,http);send(res,200,{ok:true});return true;
  }
  if(req.method==='POST'&&pathname==='/api/publishing/jobs'){
   if(!(process.env.R2_ACCOUNT_ID&&process.env.R2_ACCESS_KEY_ID&&process.env.R2_SECRET_ACCESS_KEY&&process.env.R2_BUCKET_NAME))throw new PublishingError('publishing_storage_unavailable',503);
   if(!renderer()){send(res,503,{error:'renderer_unavailable'});return true;}
   const value=await body(req),parsed=await enqueuePublication(db,user.id,value);
   send(res,202,parsed);return true;
  }
  const retry=/^\/api\/publishing\/targets\/([1-9]\d*)\/retry$/.exec(pathname);
  if(req.method==='POST'&&retry){
   await body(req);
   if(!await retryPublication(db,user.id,retry[1]))throw new PublishingError('target_not_retryable',409);
   send(res,200,{ok:true});return true;
  }
  send(res,404,{error:'publishing_route_not_found'});
 }catch(error){
  send(res,error instanceof PublishingError?error.status:503,{error:error instanceof PublishingError?error.code:'publishing_temporarily_unavailable'});
 }
 return true;
}
