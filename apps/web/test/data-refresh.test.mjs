import test from 'node:test';
import assert from 'node:assert/strict';
// Node 22 strips the purely type-only syntax from our TS event utility.
globalThis.window=new EventTarget();
globalThis.document=new EventTarget();
document.visibilityState='visible';
// Avoid keeping a real worker-thread BroadcastChannel alive during these tests.
globalThis.BroadcastChannel=undefined;
const {notifyV2DataChanged,subscribeV2DataChanges,subscribeV2Resume,matchesV2DataChange}
 =await import('../src/data-refresh-v2.ts');

test('same-tab changes update only subscribed scopes and matching users',()=>{
 let library=0,flags=0,otherUser=0;
 const unsubs=[
  subscribeV2DataChanges(['library'],()=>library++,7),
  subscribeV2DataChanges(['saves','publications'],()=>flags++,7),
  subscribeV2DataChanges(['library'],()=>otherUser++,8)
 ];
 notifyV2DataChanged(['library'],7);
 notifyV2DataChanged(['publications'],7);
 notifyV2DataChanged(['saves'],8);
 assert.deepEqual([library,flags,otherUser],[1,1,0]);
 assert.equal(matchesV2DataChange({scopes:['saves'],actorId:7},['saves'],8),false);
 assert.equal(matchesV2DataChange({scopes:['saves'],actorId:7},['saves'],7),true);
 unsubs.forEach(unsub=>unsub());
 notifyV2DataChanged(['library'],7);
 assert.equal(library,1);
});
test('unknown notifications are ignored; shared link notifications refresh all listeners',()=>{
 let count=0;
 const unsub=subscribeV2DataChanges(['shares'],()=>count++,23);
 window.dispatchEvent(new CustomEvent('1ce:v2:data-change',{detail:{scopes:['anything'],actorId:23}}));
 window.dispatchEvent(new CustomEvent('1ce:v2:data-change',{detail:{scopes:['shares'],actorId:'wrong'}}));
 assert.equal(count,0);
 notifyV2DataChanged(['shares']);
 assert.equal(count,1);
 unsub();
});
test('focus/visibility events coalesce and listeners clean up',()=>{
 let count=0;
 const unsub=subscribeV2Resume(()=>count++,10000);
 window.dispatchEvent(new Event('focus'));
 window.dispatchEvent(new Event('focus'));
 document.dispatchEvent(new Event('visibilitychange'));
 assert.equal(count,1);
 document.visibilityState='hidden';
 document.dispatchEvent(new Event('visibilitychange'));
 assert.equal(count,1);
 unsub();
 document.visibilityState='visible';
 window.dispatchEvent(new Event('focus'));
 assert.equal(count,1);
});
