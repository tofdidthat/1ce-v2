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
 pending:Promise<string|null>|null;controller:AbortController|null;removed:boolean;stale:boolean;
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
  // Memory-only, viewer-scoped and cleared on account/workspace change.
  // Keep already-authorized covers through normal back navigation instead of
  // re-downloading every card after two minutes.
  this.ttlMs=options.ttlMs??30*60*1000;
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
  if(!entry||entry.stale)return null;
  if(this.expired(entry)){this.drop(key,entry);return null;}
  return entry.url;
 }
 acquire(ownerId:number,fileId:number):CoverLeaseV2{
  const key=this.key(ownerId,fileId);
  let entry=this.entries.get(key);
  if(entry&&(entry.stale||this.expired(entry))){this.drop(key,entry);entry=undefined;}
  if(!entry){
   entry={refs:0,url:null,bytes:0,loadedAt:0,usedAt:0,pending:null,controller:null,removed:false,stale:false};
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
    if(ownedEntry.stale||this.expired(ownedEntry))this.drop(key,ownedEntry);
    else this.trim();
   }
  };
 }
 // A mutation by this owner (cover change, delete/testing, publish) drops only
 // that owner's cached covers. A cover still displayed stays valid until its
 // consumer re-acquires, then the stale entry is revoked and fetched again.
 // Other accounts mentioned on the same page keep their own entries.
 invalidateOwner(ownerId:number){
  if(!Number.isSafeInteger(ownerId)||ownerId<1)return;
  const prefix=ownerId+':';
  for(const [key,entry] of [...this.entries]){
   if(!key.startsWith(prefix))continue;
   entry.stale=true;
   if(entry.refs===0){this.drop(key,entry);continue;}
   entry.controller?.abort();
  }
 }
 // Workspace unmount or viewer change: abort and revoke all previously seen images.
 clear(){
  for(const [key,entry] of this.entries)this.drop(key,entry);
  this.totalBytes=0;
 }
}
