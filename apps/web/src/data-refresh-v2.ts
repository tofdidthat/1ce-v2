// Lightweight client-side refresh notifications for the 1CE v2 workspace.
// No polling, global state store, extra dependency, project copies or v1 data.
export type V2DataScope='library'|'saves'|'publications'|'shares'|'identity'|'follows';
export type V2DataChange={scopes:V2DataScope[];actorId:number|null};
const EVENT='1ce:v2:data-change';
const CHANNEL='1ce:v2:data-change:tabs';
const knownScopes=new Set<V2DataScope>(['library','saves','publications','shares','identity','follows']);
let sharedChannel:BroadcastChannel|null|undefined;

function channel(){
 if(sharedChannel!==undefined)return sharedChannel;
 if(typeof window==='undefined'||typeof BroadcastChannel==='undefined')return null;
 try{sharedChannel=new BroadcastChannel(CHANNEL);}catch{sharedChannel=null;}
 return sharedChannel;
}

function parseChange(value:unknown):V2DataChange|null{
 if(!value||typeof value!=='object')return null;
 const candidate=value as Partial<V2DataChange>;
 if(!Array.isArray(candidate.scopes)||!candidate.scopes.length||
  !candidate.scopes.every(scope=>knownScopes.has(scope)))return null;
 if(candidate.actorId!==null&&(!Number.isSafeInteger(candidate.actorId)||Number(candidate.actorId)<1))return null;
 return {scopes:candidate.scopes,actorId:candidate.actorId??null};
}

export function matchesV2DataChange(change:V2DataChange,scopes:readonly V2DataScope[],userId?:number|null){
 return (!userId||change.actorId===null||change.actorId===userId)
  &&change.scopes.some(scope=>scopes.includes(scope));
}

export function notifyV2DataChanged(scopes:readonly V2DataScope[],actorId?:number|null){
 if(typeof window==='undefined')return;
 const unique=[...new Set(scopes)].filter(scope=>knownScopes.has(scope));
 if(!unique.length)return;
 const change:V2DataChange={scopes:unique,actorId:actorId&&Number.isSafeInteger(actorId)?actorId:null};
 window.dispatchEvent(new CustomEvent<V2DataChange>(EVENT,{detail:change}));
 // One singleton channel per tab: the sending channel doesn't receive its
 // own message, so subscribers don't refresh twice for a single mutation.
 channel()?.postMessage(change);
}

export function subscribeV2DataChanges(scopes:readonly V2DataScope[],callback:(change:V2DataChange)=>void,userId?:number|null){
 if(typeof window==='undefined')return ()=>{};
 const onChange=(event:Event)=>{
  const change=parseChange((event as CustomEvent<unknown>).detail);
  if(change&&matchesV2DataChange(change,scopes,userId))callback(change);
 };
 const onMessage=(event:MessageEvent)=>{
  const change=parseChange(event.data);
  if(change&&matchesV2DataChange(change,scopes,userId))callback(change);
 };
 window.addEventListener(EVENT,onChange);
 const bc=channel();
 bc?.addEventListener('message',onMessage);
 return ()=>{window.removeEventListener(EVENT,onChange);bc?.removeEventListener('message',onMessage);};
}

// Refresh only when the user returns to this tab/window; never interval poll.
// Throttle the focus/visibility events that browsers fire in quick succession.
export function subscribeV2Resume(callback:()=>void,minIntervalMs=3500){
 if(typeof window==='undefined'||typeof document==='undefined')return ()=>{};
 let lastRefresh=0;
 const revalidate=()=>{
  if(document.visibilityState==='hidden')return;
  const now=Date.now();
  if(lastRefresh&&now-lastRefresh<minIntervalMs)return;
  lastRefresh=now;
  callback();
 };
 const onVisibility=()=>{if(document.visibilityState==='visible')revalidate();};
 const onPageShow=(event:PageTransitionEvent)=>{if(event.persisted)revalidate();};
 window.addEventListener('focus',revalidate);
 document.addEventListener('visibilitychange',onVisibility);
 window.addEventListener('pageshow',onPageShow);
 return ()=>{
  window.removeEventListener('focus',revalidate);
  document.removeEventListener('visibilitychange',onVisibility);
  window.removeEventListener('pageshow',onPageShow);
 };
}
