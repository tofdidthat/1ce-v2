import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFileSync} from 'node:fs';
import {normalizeProfileLinksV2,readProfileLinksV2} from '../src/profile-links.js';
import {handleProfileIdentity} from '../src/profile-identity.js';
import {handlePublicProfiles} from '../src/public-profiles.js';

function fixture(){
 const state={username:'original',links:[],id:2},calls=[];
 const query=async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.startsWith('CREATE TABLE')||sql.startsWith('CREATE INDEX')||sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rowCount:0,rows:[]};
  if(sql.startsWith('UPDATE account_users SET username=')){state.username=args[0];return {rowCount:1,rows:[]};}
  if(sql.startsWith('INSERT INTO v2_profile_links')){state.links=JSON.parse(args[1]);return {rowCount:1,rows:[]};}
  if(sql==='SELECT links FROM v2_profile_links WHERE user_id=$1')return {rowCount:state.links.length?1:0,rows:state.links.length?[{links:state.links}]:[]};
  if(sql.startsWith('SELECT id,name,picture,username,'))return {rowCount:1,rows:[{id:state.id,name:'Producer',username:state.username,picture:null}]};
  if(sql.includes('FROM v2_public_saves s')||sql.includes('FROM v2_public_projects pub'))return {rowCount:0,rows:[]};
  throw Error('Unexpected query '+sql);
 };
 const pool={calls,query,async connect(){return {query,release(){}}}};
 const currentUser=async()=>({id:state.id,username:state.username});
 return {state,pool,currentUser,calls};
}
function request(method,body){
 const bytes=body===undefined?Buffer.alloc(0):Buffer.from(JSON.stringify(body));
 const req=Readable.from(bytes.length?[bytes]:[]);req.method=method;req.headers={};
 const res={status:null,body:null,writeHead(status){this.status=status},end(raw){this.body=raw?JSON.parse(raw):null;}};
 return {req,res};
}
async function patch(db,viewer,body){
 const {req,res}=request('PATCH',body);
 await handleProfileIdentity(req,res,'/auth/me',db.pool,viewer==null?async()=>null:async()=>({id:viewer,username:db.state.username}));
 return res;
}
async function profile(db,viewer){
 const {req,res}=request('GET');
 await handlePublicProfiles(req,res,'/api/public/profile/2',db.pool,viewer==null?async()=>null:db.currentUser);
 return res;
}
test('social URLs allow only unique HTTPS public hostnames and never script or local addresses',()=>{
 assert.deepEqual(normalizeProfileLinksV2([]),[]);
 assert.deepEqual(normalizeProfileLinksV2(['https://open.spotify.com/artist/example','https://youtube.com/@artist','https://instagram.com/artist']),['https://open.spotify.com/artist/example','https://youtube.com/@artist','https://instagram.com/artist']);
 for(const input of [
  ['javascript:alert(1)'],['http://instagram.com/u'],['https://user:pass@example.com'],
  ['https://localhost/profile'],['https://192.168.1.1'],['https://[::1]'],
  ['https://example.local/x'],['https://example.com:8443'],['https://example.com','https://example.com/'],
  Array(7).fill('https://www.spotify.com'),['https://example.com/space x'],[1],null
 ]){
  assert.equal(normalizeProfileLinksV2(input),null,JSON.stringify(input));
 }
});
test('existing PATCH auth/me persists profile links, rejects anonymous requests, no extra route',async()=>{
 const db=fixture();
 assert.equal((await patch(db,null,{links:['https://spotify.com/a']})).status,401);
 assert.equal((await patch(db,2,{links:['javascript:bad']})).status,400);
 assert.deepEqual(db.state.links,[]);
 const saved=await patch(db,2,{links:['https://open.spotify.com/artist/abc','https://instagram.com/a']});
 assert.equal(saved.status,200);
 assert.deepEqual(saved.body.links,db.state.links);
 const loaded=await readProfileLinksV2(db.pool,2);
 assert.deepEqual(loaded,db.state.links);
 const publicView=await profile(db,null);
 assert.equal(publicView.status,200);
 assert.deepEqual(publicView.body.profile.links,db.state.links);
 assert.equal(publicView.body.profile.email,undefined);
 assert.ok(!db.calls.some(c=>/^(INSERT|UPDATE|DELETE) /.test(c.sql)&&c.sql.includes('v2_project_access')));
});
test('patch supports username-only Settings behavior and atomic combined username+links',async()=>{
 const db=fixture();
 const usernameOnly=await patch(db,2,{username:'new.handle'});
 assert.equal(usernameOnly.status,200);
 assert.equal(db.state.username,'new.handle');
 const both=await patch(db,2,{username:'new.handle2',links:['https://youtube.com/@artist']});
 assert.equal(both.status,200);
 assert.equal(db.state.username,'new.handle2');
 assert.deepEqual(db.state.links,['https://youtube.com/@artist']);
 const operations=db.calls.map(c=>c.sql);
 assert.ok(operations.includes('BEGIN'));
 assert.ok(operations.includes('COMMIT'));
 assert.equal((await patch(db,2,{})).status,400);
 const ddl=readFileSync(new URL('../../../history/database/009_profile_links.sql',import.meta.url),'utf8');
 assert.match(ddl,/user_id INTEGER PRIMARY KEY REFERENCES account_users\(id\) ON DELETE CASCADE/);
 assert.match(ddl,/links JSONB NOT NULL/);
});
