// Isolated CircleCI compiled API smoke: no database credentials or external R2.
// The API should start on loopback, reject anonymous/cross-origin traffic,
// and close all handles before reporting success.
import assert from 'node:assert/strict';
import {apiServer,apiPool} from '../dist/server.js';

try {
  await new Promise((resolve,reject)=>{
    apiServer.once('error',reject);
    apiServer.listen(0,'127.0.0.1',resolve);
  });
  const url='http://127.0.0.1:'+apiServer.address().port;
  const health=await fetch(url+'/health');
  assert.equal(health.status,200);
  assert.match(health.headers.get('cache-control')||'',/no-store/i);
  assert.deepEqual(await health.json(),{ok:true,service:'1ce-v2-api'});
  assert.equal((await fetch(url+'/auth/me')).status,401);
  assert.equal((await fetch(url+'/auth/me',{
    headers:{Origin:'https://untrusted.invalid'}
  })).status,403);
  console.log('Compiled API smoke: PASS');
} finally {
  if(apiServer.listening){
    await new Promise((resolve,reject)=>apiServer.close(error=>error?reject(error):resolve()));
  }
  await apiPool.end();
}
