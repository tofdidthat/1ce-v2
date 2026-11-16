const prefix='onece-publishing-request-v1:';
const lifetimeMs=30*24*60*60*1000;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
type StoredRequest={requestId:string;createdAt:number};

function accountPrefix(userId:number):string{return prefix+userId+':';}
function storageValue(storage:StorageLike,key:string,now:number):StoredRequest|null{
 const raw=storage.getItem(key);if(!raw)return null;
 try{
  const value=JSON.parse(raw) as Partial<StoredRequest>;
  if(typeof value.requestId!=='string'||!uuid.test(value.requestId)||
   !Number.isSafeInteger(value.createdAt)||value.createdAt!>now||now-value.createdAt!>lifetimeMs){
   storage.removeItem(key);return null;
  }
  return value as StoredRequest;
 }catch{storage.removeItem(key);return null;}
}
async function intentKey(userId:number,intent:unknown):Promise<string>{
 const value=intent&&typeof intent==='object'&&!Array.isArray(intent)?{...(intent as Record<string,unknown>)}:intent;
 if(value&&typeof value==='object'&&!Array.isArray(value)&&Array.isArray((value as Record<string,unknown>).targets)){
  const record=value as Record<string,unknown>;
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
// caption, credentials, or upload bytes. Shared localStorage coordinates tabs.
export async function requestIdForPublishingIntent(userId:number,intent:unknown,
 storage:StorageLike=window.localStorage,now=Date.now()):Promise<string>{
 if(!Number.isSafeInteger(userId)||userId<=0)throw Error('Invalid publishing account');
 const requestId=crypto.randomUUID();
 try{
  const key=await intentKey(userId,intent),saved=storageValue(storage,key,now);
  if(saved)return saved.requestId;
  storage.setItem(key,JSON.stringify({requestId,createdAt:now} satisfies StoredRequest));
 }catch{/* Restricted storage should not block publishing; the component still reuses its in-memory id. */}
 return requestId;
}

export function reconcilePublishingRequestIds(userId:number,requestIds:readonly string[],
 storage:StorageLike=window.localStorage,now=Date.now()):void{
 if(!Number.isSafeInteger(userId)||userId<=0)return;
 try{
  const prefixForAccount=accountPrefix(userId),accepted=new Set(requestIds);
  for(let index=storage.length-1;index>=0;index--){
   const key=storage.key(index);if(!key?.startsWith(prefixForAccount))continue;
   const saved=storageValue(storage,key,now);
   if(saved&&accepted.has(saved.requestId))storage.removeItem(key);
  }
 }catch{/* Restricted storage should not block status refresh. */}
}
