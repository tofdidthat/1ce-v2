const prefix='onece-publishing-request-v1:';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
type StoredRequest={requestId:string;createdAt:number;acknowledged?:boolean};
const storageError=()=>Error('Unable to save this publication attempt. Enable site storage before publishing.');

function accountPrefix(userId:number):string{return prefix+userId+':';}
function storageValue(storage:StorageLike,key:string,now:number):StoredRequest|null{
 const raw=storage.getItem(key);if(!raw)return null;
 try{
  const value=JSON.parse(raw) as Partial<StoredRequest>;
  if(typeof value.requestId!=='string'||!uuid.test(value.requestId)||
   !Number.isSafeInteger(value.createdAt)||value.createdAt!<0)throw storageError();
  return value as StoredRequest;
 }catch{throw storageError();}
}
async function intentKey(userId:number,intent:unknown):Promise<string>{
 const value=intent&&typeof intent==='object'&&!Array.isArray(intent)?{...(intent as Record<string,unknown>)}:intent;
 if(value&&typeof value==='object'&&!Array.isArray(value)&&Array.isArray((value as Record<string,unknown>).targets)){
  const record=value as Record<string,unknown>;
  for(const field of ['title','description','hashtags'])if(typeof record[field]==='string')record[field]=record[field].trim();
  record.targets=[...(record.targets as unknown[])].sort((left,right)=>{
   const key=(target:unknown)=>target&&typeof target==='object'?
    String((target as Record<string,unknown>).platform)+':'+String((target as Record<string,unknown>).variant):'';
   return key(left).localeCompare(key(right));
  });
 }
 const canonical=JSON.stringify(value);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));
 const fingerprint=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
 return accountPrefix(userId)+fingerprint;
}

// Keep only an opaque digest and request UUID locally; never persist the title,
// caption, credentials, or upload bytes. Never expire an unresolved attempt or
// erase it on status refresh: a successful job may have lost its POST response.
export async function requestIdForPublishingIntent(userId:number,intent:unknown,
 storage:StorageLike=window.localStorage,now=Date.now()):Promise<string>{
 if(!Number.isSafeInteger(userId)||userId<=0)throw Error('Invalid publishing account');
 try{
  const key=await intentKey(userId,intent);
  const reserve=()=>{
   const saved=storageValue(storage,key,now);if(saved)return saved.requestId;
   const requestId=crypto.randomUUID();
   storage.setItem(key,JSON.stringify({requestId,createdAt:now} satisfies StoredRequest));
   if(storageValue(storage,key,now)?.requestId!==requestId)throw storageError();
   return requestId;
  };
  // Web Locks serialize same-intent submissions in different browser tabs.
  // Reject through a promise: Node 26's LockManager leaves a synchronous
  // callback exception pending, which otherwise stalls storage-failure tests.
  return typeof navigator!=='undefined'&&navigator.locks
   ?await navigator.locks.request(key,async()=>reserve()):reserve();
 }catch{throw storageError();}
}

export function reconcilePublishingRequestIds(userId:number,requestIds:readonly string[],
 storage:StorageLike=window.localStorage,now=Date.now()):void{
 if(!Number.isSafeInteger(userId)||userId<=0)return;
 try{
  const prefixForAccount=accountPrefix(userId),accepted=new Set(requestIds);
  for(let index=storage.length-1;index>=0;index--){
   const key=storage.key(index);if(!key?.startsWith(prefixForAccount))continue;
   const saved=storageValue(storage,key,now);
   if(saved&&accepted.has(saved.requestId)&&!saved.acknowledged)
    storage.setItem(key,JSON.stringify({...saved,acknowledged:true}));
  }
 }catch{/* Restricted storage should not block status refresh. */}
}

// Only an explicit new-publication action after server acknowledgement can
// discard an attempt. Merely seeing a terminal job in history is insufficient.
export function beginAnotherPublishingRequest(userId:number,requestId:string,storage:StorageLike=window.localStorage):void{
 try{
  for(let index=storage.length-1;index>=0;index--){
   const key=storage.key(index);if(!key?.startsWith(accountPrefix(userId)))continue;
   const saved=storageValue(storage,key,Date.now());
   if(saved?.requestId===requestId){
    if(!saved.acknowledged)throw storageError();
    storage.removeItem(key);if(storage.getItem(key)!==null)throw storageError();
   }
  }
 }catch{throw storageError();}
}
