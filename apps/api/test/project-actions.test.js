import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {handleProjectActions} from '../dist/project-actions.js';

const beat='75f80bde-7b6a-4b18-8b1f-4e52eb98f776';
const second='5fd06bbc-c6a7-43f6-9205-bac180ba9273';
const pack='e2c0e2e6-2e40-4cdf-a207-1ba6cc66cc2a';
const pack2='36a40238-f0d5-47d5-8193-36b9309c53b7';

function fixture({owner=1,missing=false,badCover=false,members=[],cascadedBeats=[]}={}){
 const calls=[];
 const rows={
  beat:{id:beat,title:'Original',cover_file_id:15},
  pack:{id:pack,title:'Original pack',cover_file_id:15}
 };
 const ctx={
  calls,query:async(sql,args=[])=>{
   calls.push({sql,args});
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rowCount:0,rows:[]};
   if(sql.includes('FOR UPDATE')){
    const type=sql.includes('library_beats')?'beat':'pack';
    const correct=Number(args[1])===owner&&(!missing)&&(type==='beat'?args[0]===beat:args[0]===pack||args[0]===pack2);
    return {rowCount:correct?1:0,rows:correct?[rows[type]]:[]};
   }
   if(sql.startsWith("SELECT id FROM library_files"))return {rowCount:badCover?0:1,rows:badCover?[]:[{id:100}]};
   if(sql.startsWith('SELECT id FROM library_beats'))return {rowCount:missing?0:1,rows:missing?[]:[{id:beat}]};
   if(sql.includes('SELECT b.id FROM library_packs'))return {rowCount:missing?0:2,rows:missing?[]:[{id:beat},{id:second}]};
   if(sql.startsWith('SELECT beat_id,position FROM library_pack_beats'))return {rowCount:members.length,rows:members};
   if(sql.startsWith('SELECT beat_id FROM library_pack_beats'))return {rowCount:members.length,rows:members};
   if(sql.startsWith('UPDATE library_beats b SET deleted_at=p.deleted_at'))return {rowCount:cascadedBeats.length,rows:cascadedBeats.map(id=>({id}))};
   if(sql.includes('SET deleted_at=now()'))return {rowCount:missing?0:1,rows:missing?[]:[{id:args[1]}]};
   if(sql.startsWith('UPDATE library_'))return {rowCount:1,rows:[{id:args[1],title:args[0]??'Original',cover_file_id:args[0]}]};
   return {rowCount:1,rows:[]};
  },connect:async()=>({query:(...args)=>ctx.query(...args),release(){calls.push({sql:'RELEASE'})}})};
 return ctx;
}
async function invoke(pool,method,path,body,user={id:1}){
 const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
 req.method=method;req.headers={};
 const response={status:null,body:null,writeHead(status){this.status=status;},end(body){this.body=body?JSON.parse(body):null;}};
 const handled=await handleProjectActions(req,response,'/api/library/projects/'+path,pool,async()=>user);
 assert.equal(handled,true);
 return response;
}
test('rejects anonymous and non-owner access without leaking project info',async()=>{
 const db=fixture({owner:1,missing:true});
 assert.equal((await invoke(db,'PATCH','beat/'+beat,{title:'X'},null)).status,401);
 assert.equal((await invoke(db,'DELETE','beat/'+beat)).status,404);
 assert.equal(db.calls.some(x=>x.sql.startsWith('DELETE FROM')),false);
});
test('rename validates input and changes only the owner project title',async()=>{
 const db=fixture();
 assert.equal((await invoke(db,'PATCH','beat/'+beat,{title:''})).status,400);
 const out=await invoke(db,'PATCH','beat/'+beat,{title:'  Fresh title  '});
 assert.equal(out.status,200);
 const update=db.calls.find(x=>x.sql.includes('UPDATE library_beats'));
 assert.deepEqual(update.args,['Fresh title',beat,1]);
 assert.equal(update.sql.includes('title=$1'),true);
 assert.equal(db.calls.at(-2).sql,'COMMIT');
});
test('cover change requires ready owner cover and permits explicit null',async()=>{
 const denied=fixture({badCover:true});
 assert.equal((await invoke(denied,'PATCH','beat/'+beat,{coverFileId:100})).status,400);
 assert.equal(denied.calls.some(x=>x.sql.includes('UPDATE library_')),false);
 const db=fixture();
 assert.equal((await invoke(db,'PATCH','pack/'+pack,{coverFileId:null})).status,200);
 const update=db.calls.find(x=>x.sql.includes('UPDATE library_packs'));
 assert.equal(update.args[0],null);
 assert.equal(update.sql.includes('cover_file_id=$1'),true);
});
test('add a beat to existing pack adds only missing references in transaction',async()=>{
 const db=fixture();
 const result=await invoke(db,'POST','pack/'+pack+'/add',{sourceKind:'beat',sourceId:beat});
 assert.equal(result.status,200);
 assert.equal(result.body.added,1);
 assert.equal(db.calls.filter(x=>x.sql.startsWith('INSERT INTO library_pack_beats')).length,1);
 assert.equal(db.calls.some(x=>x.sql.includes('INSERT INTO library_files')),false);
 assert.equal(db.calls.at(-2).sql,'COMMIT');
});
test('pack-to-pack Add to flattens ordered beat references, never nests packs',async()=>{
 const db=fixture({members:[{beat_id:beat,position:0}]});
 const result=await invoke(db,'POST','pack/'+pack2+'/add',{sourceKind:'pack',sourceId:pack});
 assert.equal(result.status,200);
 assert.equal(result.body.added,1);
 const inserted=db.calls.filter(x=>x.sql.startsWith('INSERT INTO library_pack_beats'));
 assert.equal(inserted.length,1);
 assert.equal(inserted[0].args[1],second);
 assert.equal(db.calls.some(x=>x.sql.includes('INSERT INTO library_packs')),false);
 assert.equal((await invoke(db,'POST','pack/'+pack+'/add',{sourceKind:'pack',sourceId:pack})).status,400);
});
test('new project creates a pack with references even from a single beat',async()=>{
 const db=fixture();
 const result=await invoke(db,'POST','packs/from',{sourceKind:'beat',sourceId:beat,title:'New project'});
 assert.equal(result.status,201);
 assert.equal(result.body.track_count,1);
 assert.equal(db.calls.filter(x=>x.sql.startsWith('INSERT INTO library_packs')).length,1);
 assert.equal(db.calls.filter(x=>x.sql.startsWith('INSERT INTO library_pack_beats')).length,1);
 assert.equal(db.calls.filter(x=>x.sql.includes('library_files')&&x.sql.startsWith('INSERT')).length,0);
});
test('delete beat moves it to Trash, revokes public edges and retains media and membership',async()=>{
 const db=fixture();
 const response=await invoke(db,'DELETE','beat/'+beat);
 assert.equal(response.status,200);
 assert.equal(response.body.trashed,true);
 assert.equal(response.body.restoreDays,30);
 const queries=db.calls.map(x=>x.sql);
 assert.equal(queries.some(sql=>sql.startsWith("UPDATE library_beats SET deleted_at=now()")),true);
 for(const table of ['v2_public_projects','v2_public_saves','v2_project_access','v2_project_share_links'])
  assert.equal(queries.some(sql=>sql.startsWith('DELETE FROM '+table)),true,table);
 for(const table of ['library_beats','library_pack_beats','library_files'])
  assert.equal(queries.some(sql=>sql.startsWith('DELETE FROM '+table)),false,table);
});
test('delete pack moves the pack to Trash while preserving beats and R2 objects',async()=>{
 const db=fixture();
 const response=await invoke(db,'DELETE','pack/'+pack);
 assert.equal(response.status,200);
 assert.equal(response.body.trashed,true);
 assert.equal(db.calls.some(x=>x.sql.startsWith("UPDATE library_packs SET deleted_at=now()")),true);
 assert.equal(db.calls.some(x=>x.sql.startsWith('DELETE FROM library_packs')),false);
 assert.equal(db.calls.some(x=>x.sql.startsWith('DELETE FROM library_beats')),false);
 assert.equal(db.calls.some(x=>x.sql.startsWith('DELETE FROM library_files')),false);
});

test('pack delete cascades hidden-only beats and revokes their public edges',async()=>{
 const db=fixture({cascadedBeats:[beat]});
 const response=await invoke(db,'DELETE','pack/'+pack);
 assert.equal(response.status,200);
 const cascade=db.calls.find(x=>x.sql.startsWith('UPDATE library_beats b SET deleted_at=p.deleted_at'));
 assert.ok(cascade);
 assert.match(cascade.sql,/b.library_visible=FALSE/);
 assert.match(cascade.sql,/other.deleted_at IS NULL/);
 assert.deepEqual(cascade.args,[1,pack]);
 for(const edge of ['v2_public_projects','v2_public_saves','v2_project_access','v2_project_share_links']){
  const calls=db.calls.filter(x=>x.sql.startsWith('DELETE FROM '+edge));
  assert.equal(calls.length,2);
  assert.match(calls[1].sql,/kind='beat'/);
  assert.deepEqual(calls[1].args,[1,[beat]]);
 }
 assert.equal(db.calls.some(x=>x.sql.startsWith('DELETE FROM library_files')),false);
});

test('another account cannot rename, recolor or attach to the owner pack',async()=>{
 const db=fixture({owner:1});
 const outsider={id:2};
 assert.equal((await invoke(db,'PATCH','beat/'+beat,{title:'Stolen title'},outsider)).status,404);
 assert.equal((await invoke(db,'PATCH','pack/'+pack,{coverFileId:100},outsider)).status,404);
 assert.equal((await invoke(db,'POST','pack/'+pack+'/add',{sourceKind:'beat',sourceId:beat},outsider)).status,404);
 assert.equal(db.calls.some(c=>/^(UPDATE|INSERT|DELETE) library_/.test(c.sql)),false);
 assert.ok(db.calls.filter(c=>c.sql==='ROLLBACK').length>=3);
});

test('owner can attach ready private stems to an original beat, with no media copy',async()=>{
 const db=fixture();
 const response=await invoke(db,'PATCH','beat/'+beat,{stemsFileId:100});
 assert.equal(response.status,200);
 const check=db.calls.find(c=>c.sql.includes("kind='stems' AND status='ready'"));
 assert.deepEqual(check.args,[100,1]);
 const change=db.calls.find(c=>c.sql.startsWith('UPDATE library_beats SET stems_file_id='));
 assert.ok(change);
 assert.deepEqual(change.args,[100,beat,1]);
 assert.ok(change.sql.includes('RETURNING id,title,cover_file_id,stems_file_id'));
 assert.equal(db.calls.some(c=>c.sql.startsWith('INSERT INTO library_files')),false);
 assert.equal(db.calls.at(-2).sql,'COMMIT');
});
test('stems changes reject wrong kind, invalid IDs and foreign/unready objects',async()=>{
 const db=fixture();
 for(const body of [{stemsFileId:0},{stemsFileId:1.5},{stemsFileId:'42'},{stemsFileId:undefined},{title:'X',stemsFileId:100}]){
  assert.equal((await invoke(db,'PATCH','beat/'+beat,body)).status,400);
 }
 assert.equal((await invoke(db,'PATCH','pack/'+pack,{stemsFileId:100})).status,400);
 assert.equal(db.calls.some(c=>c.sql.startsWith('UPDATE library_')&&c.sql.includes('stems_file_id')),false);
 const foreign=fixture({badCover:true});
 assert.equal((await invoke(foreign,'PATCH','beat/'+beat,{stemsFileId:100})).status,400);
 assert.equal(foreign.calls.some(c=>c.sql.startsWith('UPDATE library_')),false);
 const other=fixture({missing:true});
 assert.equal((await invoke(other,'PATCH','beat/'+beat,{stemsFileId:100})).status,404);
});
test('owner can detach stems without deleting original R2 bytes',async()=>{
 const db=fixture();
 const response=await invoke(db,'PATCH','beat/'+beat,{stemsFileId:null});
 assert.equal(response.status,200);
 const update=db.calls.find(c=>c.sql.startsWith('UPDATE library_beats SET stems_file_id='));
 assert.deepEqual(update.args,[null,beat,1]);
 assert.equal(db.calls.some(c=>c.sql.startsWith('DELETE FROM library_files')),false);
});
