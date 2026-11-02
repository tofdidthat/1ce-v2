import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {audioRange,streamAuthorizedAudio} from '../src/audio-stream.js';

test('byte ranges preserve full, partial, suffix and open-ended audio streams',()=>{
 assert.deepEqual(audioRange(undefined,100),{status:200,start:0,end:99});
 assert.deepEqual(audioRange('bytes=10-19',100),{status:206,start:10,end:19});
 assert.deepEqual(audioRange('bytes=80-',100),{status:206,start:80,end:99});
 assert.deepEqual(audioRange('bytes=-10',100),{status:206,start:90,end:99});
 assert.deepEqual(audioRange('bytes=0-200',100),{status:206,start:0,end:99});
 for(const invalid of ['bytes=100-','bytes=10-9','bytes=-0','bytes=1-2,3-4','bytes=garbage','items=0-4']){
  assert.equal(audioRange(invalid,100),null,invalid);
 }
});
test('R2 receives only the authorized object key and requested range',async()=>{
 const calls=[];
 const s3={async send(command){calls.push(command.input);return {Body:Readable.from([Buffer.from('12345')])};}};
 const headers={};let status,body='';
 const res={writeHead(s,h){status=s;Object.assign(headers,h)},write(chunk){body+=chunk.toString()},end(){}};
 await streamAuthorizedAudio({headers:{range:'bytes=3-7'}},res,{
  s3,bucket:'private-v2-test',file:{object_key:'users/1/assets/audio/fake',byte_size:100,content_type:'audio/mpeg'}
 });
 assert.equal(status,206);
 assert.equal(headers['Cache-Control'],'private, no-store');
 assert.equal(headers['Content-Range'],'bytes 3-7/100');
 assert.equal(headers['Content-Length'],5);
 assert.equal(calls[0].Bucket,'private-v2-test');
 assert.equal(calls[0].Key,'users/1/assets/audio/fake');
 assert.equal(calls[0].Range,'bytes=3-7');
 assert.equal(body,'12345');
});
test('unsatisfiable ranges never reach private object storage',async()=>{
 let called=false;let status,headers;
 const res={writeHead(s,h){status=s;headers=h},end(){}};
 await streamAuthorizedAudio({headers:{range:'bytes=1000-'}},res,{
  s3:{async send(){called=true}},bucket:'isolated-v2',file:{object_key:'x',byte_size:1000,content_type:'audio/mpeg'}
 });
 assert.equal(status,416);
 assert.equal(headers['Content-Range'],'bytes */1000');
 assert.equal(called,false);
});
