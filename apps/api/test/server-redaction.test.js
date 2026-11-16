import test from 'node:test';
import assert from 'node:assert/strict';
import {apiServer,apiPool} from '../dist/server.js';

test('real API error handlers redact upstream credentials before console output',{timeout:5000},async()=>{
 const logs=[],originalQuery=apiPool.query,originalError=console.error;
 const upstream='Synthetic upstream failure https://graph.invalid/token?access_token=fixture-access '+
  JSON.stringify({client_secret:'fixture-secret',cookie:'session=fixture-cookie'})+
  ' Authorization: Bearer fixture-bearer https://r2.invalid/video?X-Amz-Signature=fixture-signature';
 apiPool.query=async()=>{throw Error(upstream)};
 console.error=(...args)=>logs.push(args);
 try{
  await new Promise((resolve,reject)=>{apiServer.once('error',reject);apiServer.listen(0,'127.0.0.1',resolve)});
  const origin='http://127.0.0.1:'+apiServer.address().port;
  const health=await fetch(origin+'/health/db');
  assert.equal(health.status,503);assert.deepEqual(await health.json(),{ok:false,database:'unavailable'});
  const account=await fetch(origin+'/auth/me',{headers:{Cookie:'onece_v2_session='+'a'.repeat(64)}});
  assert.equal(account.status,500);assert.deepEqual(await account.json(),{error:'Service unavailable'});
  assert.equal(logs.length,2);
  assert.match(logs[0][0],/database health check failed/);assert.match(logs[1][0],/api error/);
  assert.doesNotMatch(JSON.stringify(logs),/fixture-(?:access|secret|cookie|bearer|signature)/);
  assert.ok(logs.every(args=>args[1].includes('[REDACTED]')));
 }finally{
  console.error=originalError;apiPool.query=originalQuery;
  if(apiServer.listening)await new Promise(resolve=>apiServer.close(resolve));
  await apiPool.end();
 }
});
