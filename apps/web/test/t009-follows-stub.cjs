// Controllable stand-in for ./profile-follows-v2 inside the behavioral bundle:
// every request is recorded with its signal and stays pending until the test
// resolves it, so cancellation of in-flight work is directly observable.
const calls=[];
const pending=[];
exports.getProfileFollowsV2=(id,signal)=>{
 const record={id,signal};
 calls.push(record);
 return new Promise((resolve,reject)=>{pending.push({resolve,reject,record});});
};
exports.calls=calls;
exports.resolve=function(record,value){
 const index=pending.findIndex(entry=>entry.record===record);
 if(index<0)throw new Error('no pending request for the given record');
 const [entry]=pending.splice(index,1);
 entry.resolve(value);
};
exports.reset=function(){calls.length=0;pending.length=0;};
