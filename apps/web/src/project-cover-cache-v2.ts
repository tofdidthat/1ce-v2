// Viewer-scoped, in-memory reuse of authorized cover bytes only.
// Never persist private blobs to disk or bypass the API's no-store policy.
export type CoverLoaderV2=(ownerId:number,fileId:number,signal:AbortSignal)=>Promise<Blob>;
export type CoverLeaseV2={url:string|null;ready:Promise<string|null>;release:()=>void};
export type CoverCacheOptionsV2={
 maxEntries?:number;maxBytes?:number;ttlMs?:number;
 now?:()=>number;makeUrl?:(blob:Blob)=>string;revokeUrl?:(url:string)=>void;
};
type Entry={
 refs:number;url:string|null;bytes:number;loadedAt:number;usedAt:number;
 pending:Promise<string|null>|null;controller:AbortController|null;removed:boolean;
};

export class ProjectCoverCacheV2{
 private readonly entries=new Map<string,Entry>();
 private readonly loader:CoverLoaderV2;
 private readonly maxEntries:number;
 private readonly maxBytes:number;
 private readonly ttlMs:number;
 private readonly now:()=>number;
 private readonly makeUrl:(blob:Blob)=>string;
 private readonly revokeUrl:(url:string)=>void;
 private totalBytes=0;
 private tick=0;

 constructor(loader:CoverLoaderV2,options:CoverCacheOptionsV2={}){
  this.loader=loader;
  this.maxEntries=options.maxEntries??48;
  this.maxBytes=options.maxBytes??48*1024*1024;
  this.ttlMs=options.ttlMs??2*60*1000;
  this.now=options.now??Date.now;
  this.makeUrl=options.makeUrl??(blob=>URL.createObjectURL(blob));
  this.revokeUrl=options.revokeUrl??(url=>URL.revokeObjectURL(url));
 }

 private key(ownerId:number,fileId:number){return ownerId+':'+fileId;}
 private expired(entry:Entry){return !!entry.url&&entry.refs===0&&this.now()-entry.loadedAt>=this.ttlMs;}
 private drop(key:string,entry:Entry){
  if(this.entries.get(key)!==entry)return;
  this.entries.delete(key);
  entry.removed=true;
  entry.controller?.abort();
  if(entry.url){this.revokeUrl(entry.url);this.totalBytes-=entry.bytes;entry.url=null;entry.bytes=0;}
 }
 private trim(){
  while(this.entries.size>this.maxEntries||this.totalBytes>this.maxBytes){
   const candidate=[...this.entries].filter(([,entry])=>entry.refs===0&&!entry.pending)
    .sort((a,b)=>a[1].usedAt-b[1].usedAt)[0];
   if(!candidate)break; // Never revoke an image still displayed in a card/player.
   this.drop(candidate[0],candidate[1]);
  }
 }
 private load(key:string,entry:Entry,ownerId:number,fileId:number):Promise<string|null>{
  const controller=new AbortController();
  entry.controller=controller;
  return this.loader(ownerId,fileId,controller.signal).then(blob=>{
   if(controller.signal.aborted||entry.removed)return null;
   if(!['image/jpeg','image/png','image/webp'].includes(blob.type))return null;
   const url=this.makeUrl(blob);
   if(controller.signal.aborted||entry.removed){this.revokeUrl(url);return null;}
   entry.url=url;
   entry.bytes=blob.size;
   entry.loadedAt=this.now();
   this.totalBytes+=blob.size;
   return url;
  }).catch(()=>null).finally(()=>{
   entry.controller=null;
   entry.pending=null;
   if(!entry.url)this.drop(key,entry); // Errors and unauthorized responses are never cached.
   else this.trim();
  });
 }
 peek(ownerId:number,fileId:number):string|null{
  const key=this.key(ownerId,fileId),entry=this.entries.get(key);
  if(!entry)return null;
  if(this.expired(entry)){this.drop(key,entry);return null;}
  return entry.url;
 }
 acquire(ownerId:number,fileId:number):CoverLeaseV2{
  const key=this.key(ownerId,fileId);
  let entry=this.entries.get(key);
  if(entry&&this.expired(entry)){this.drop(key,entry);entry=undefined;}
  if(!entry){
   entry={refs:0,url:null,bytes:0,loadedAt:0,usedAt:0,pending:null,controller:null,removed:false};
   this.entries.set(key,entry);
   entry.pending=this.load(key,entry,ownerId,fileId);
  }
  entry.refs++;
  entry.usedAt=++this.tick;
  const ownedEntry=entry;
  let released=false;
  return {
   url:entry.url,
   ready:entry.pending??Promise.resolve(entry.url),
   release:()=>{
    if(released)return;
    released=true;
    ownedEntry.refs=Math.max(0,ownedEntry.refs-1);
    if(this.entries.get(key)!==ownedEntry)return;
    if(this.expired(ownedEntry))this.drop(key,ownedEntry);
    else this.trim();
   }
  };
 }
 // Workspace unmount or viewer change: abort and revoke all previously seen images.
 clear(){
  for(const [key,entry] of this.entries)this.drop(key,entry);
  this.totalBytes=0;
 }
}
