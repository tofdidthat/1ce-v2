import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {handlePublicProfiles} from '../src/public-profiles.js';

const beat='75f80bde-7b6a-4b18-8b1f-4e52eb98f776';
const sharedToken='A'.repeat(43);

function fixture({published=false}={}){
 const calls=[];
 const saved={kind:'beat',id:beat,owner_id:1,title:'Private shared beat',cover_file_id:null,track_count:null,published_at:'2026-11-02'};
 const db={calls,async query(sql,args=[]){
  calls.push({sql,args});
  if(sql.startsWith('SELECT id,name,picture,username,'))return {rowCount:1,rows:[{id:2,name:'Saver',username:'saver'}]};
  if(sql.includes('FROM v2_public_saves s')){
   assert.match(sql,/s\.user_id=\$2\s+OR EXISTS\(SELECT 1 FROM v2_public_projects pub/,'private Saves visibility must depend on saver identity or publication');
   assert.doesNotMatch(sql,/s\.owner_id=\$2/,'underlying project owner cannot inspect a different saver’s private entry');
   assert.doesNotMatch(sql,/EXISTS\(SELECT 1 FROM v2_project_access a/,'separate grant cannot expose someone else’s private Saves');
   assert.deepEqual(args,[2,args[1]]);
   const visible=Number(args[1])===2||published;
   return {rowCount:visible?1:0,rows:visible?[saved]:[]};
  }
  if(sql.includes('FROM v2_public_projects pub'))return {rowCount:0,rows:[]};
  if(sql.startsWith('SELECT owner_id,kind,project_id FROM v2_project_share_links'))return {rowCount:1,rows:[{owner_id:1,kind:'beat',project_id:beat}]};
  if(sql.startsWith('SELECT 1 FROM library_beats'))return {rowCount:1,rows:[{id:beat}]};
  if(sql.startsWith('SELECT id FROM library_beats'))return {rowCount:1,rows:[{id:beat}]};
  if(sql.startsWith('SELECT 1 WHERE'))return {rowCount:1,rows:[{allowed:1}]};
  return {rowCount:1,rows:[]};
 }};
 return db;
}
async function request(db,method,path,viewerId){
 const req=Readable.from([]);req.method=method;req.headers={};
 const res={status:null,body:null,writeHead(status){this.status=status;},end(value){this.body=value?JSON.parse(value):null;}};
 const handled=await handlePublicProfiles(req,res,'/api/public/'+path,db,async()=>viewerId==null?null:{id:viewerId});
 assert.equal(handled,true);
 return res;
}

test('private shared save remains in the saver’s own Saves after Unpublish',async()=>{
 const db=fixture({published:false});
 const res=await request(db,'GET','profile/2',2);
 assert.equal(res.status,200);
 assert.deepEqual(res.body.saves.map(p=>p.id),[beat]);
 const query=db.calls.find(c=>c.sql.includes('FROM v2_public_saves s'));
 assert.deepEqual(query.args,[2,2]);
});
test('another viewer, project owner or separately granted recipient cannot inspect private Saves',async()=>{
 for(const viewer of [1,3,null]){
  const db=fixture({published:false});
  const res=await request(db,'GET','profile/2',viewer);
  assert.equal(res.status,200);
  assert.deepEqual(res.body.saves,[]);
 }
});
test('saved public projects can still appear on third-party profiles',async()=>{
 const db=fixture({published:true});
 const res=await request(db,'GET','profile/2',9);
 assert.equal(res.status,200);
 assert.equal(res.body.saves[0].id,beat);
});
test('redeemed share grants can save a private original without publishing it',async()=>{
 const db=fixture();
 const redeem=await request(db,'POST','redeem/'+sharedToken,2);
 assert.equal(redeem.status,200);
 assert.equal(redeem.body.ok,true);
 assert.ok(db.calls.some(c=>c.sql.startsWith('INSERT INTO v2_project_access')));
 const save=await request(db,'POST','save/1/beat/'+beat,2);
 assert.equal(save.status,200);
 assert.equal(save.body.saved,true);
 assert.ok(db.calls.some(c=>c.sql.startsWith('INSERT INTO v2_public_saves')));
 assert.equal(db.calls.some(c=>c.sql.startsWith('INSERT INTO v2_public_projects')),false);
});
test('Unpublish removes publication, not saved relationships or share grants',async()=>{
 const db=fixture();
 const unpublish=await request(db,'DELETE','publish/beat/'+beat,1);
 assert.equal(unpublish.status,200);
 assert.equal(unpublish.body.published,false);
 assert.ok(db.calls.some(c=>c.sql.startsWith('DELETE FROM v2_public_projects')));
 assert.equal(db.calls.some(c=>c.sql.startsWith('DELETE FROM v2_public_saves')),false);
 assert.equal(db.calls.some(c=>c.sql.startsWith('DELETE FROM v2_project_access')),false);
});
