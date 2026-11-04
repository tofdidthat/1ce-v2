import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {handleLibraryFiles} from '../dist/library-files.js';

const beatA='11111111-1111-4111-8111-111111111111';
const beatB='22222222-2222-4222-8222-222222222222';

function fixture(){
 const files=new Map([
  [1,{id:1,owner:42,kind:'audio',status:'ready'}],
  [2,{id:2,owner:99,kind:'cover',status:'ready'}],
  [3,{id:3,owner:42,kind:'cover',status:'pending'}],
  [4,{id:4,owner:42,kind:'cover',status:'ready'}],
  [5,{id:5,owner:42,kind:'stems',status:'ready'}]
 ]);
 const beats=new Map(),packs=[],members=[],queries=[],stored={sends:0};
 const readyOwned=(id,owner)=>{const x=files.get(Number(id));return x&&x.owner===owner&&x.status==='ready'?x:null;};
 const pool={
  async query(sql,args=[]){
   queries.push({sql,args});
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SELECT pg_advisory_xact_lock'))return {rows:[],rowCount:0};
   if(sql.startsWith("SELECT id,kind FROM library_files WHERE user_id=$1 AND status='ready'")){
    const rows=args[1].map(id=>readyOwned(id,args[0])).filter(Boolean).map(x=>({id:x.id,kind:x.kind}));
    return {rows,rowCount:rows.length};
   }
   if(sql.startsWith('SELECT id,deleted_at FROM library_beats')){
    const row=[...beats.values()].find(x=>x.user_id===args[0]&&x.audio_file_id===args[1]);
    return {rows:row?[{id:row.id,deleted_at:row.deleted_at||null}]:[],rowCount:row?1:0};
   }
   if(sql.startsWith('INSERT INTO library_beats(')){
    const [id,user_id,title,audio_file_id,cover_file_id,stems_file_id]=args;
    beats.set(id,{id,user_id,title,audio_file_id,cover_file_id,stems_file_id,library_visible:true});
    return {rows:[],rowCount:1};
   }
   if(sql.startsWith('SELECT id FROM library_beats WHERE user_id=$1')){
    const rows=args[1].filter(id=>beats.get(id)?.user_id===args[0]&&!beats.get(id)?.deleted_at).map(id=>({id}));
    return {rows,rowCount:rows.length};
   }
   if(sql.startsWith("SELECT id FROM library_files WHERE id=$1 AND user_id=$2 AND kind='cover'")){
    const file=readyOwned(args[0],args[1]);
    const rows=file?.kind==='cover'?[{id:file.id}]:[];
    return {rows,rowCount:rows.length};
   }
   if(sql.startsWith('INSERT INTO library_packs(')){
    const [id,user_id,title,cover_file_id]=args;
    packs.push({id,user_id,title,cover_file_id});return {rows:[],rowCount:1};
   }
   if(sql.startsWith('INSERT INTO library_pack_beats(')){
    members.push({pack:args[0],beat:args[1],position:args[2]});return {rows:[],rowCount:1};
   }
   if(sql.startsWith('UPDATE library_beats SET library_visible=FALSE')){
    for(const id of args[1])if(beats.get(id)?.user_id===args[0])beats.get(id).library_visible=false;
    return {rows:[],rowCount:args[1].length};
   }
   throw Error('Unexpected SQL in project ownership fixture: '+sql);
  },
  async connect(){return {query:(...args)=>this.query(...args),release(){}}}
 };
 async function invoke(route,body,user={id:42}){
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';req.headers={};
  const res={status:0,data:null,writeHead(code){this.status=code;},end(raw){this.data=raw?JSON.parse(raw):null;}};
  const used=await handleLibraryFiles(req,res,route,pool,async()=>user,{
   storageFactory:()=>({s3:{async send(){stored.sends++;throw Error('No R2 commands expected');}},bucket:'disposable-test'})
  });
  assert.equal(used,true);
  return res;
 }
 return {files,beats,packs,members,queries,stored,invoke};
}

test('beat links require owner-owned READY audio, cover and stems without uploading duplicates',async()=>{
 const h=fixture();
 const endpoint='/api/library/files/beats';
 for(const coverFileId of [2,3]){
  const res=await h.invoke(endpoint,{title:'Beat',audioFileId:1,coverFileId});
  assert.equal(res.status,400);
  assert.match(res.data.error,/owned by you and ready/);
 }
 assert.equal(h.beats.size,0);
 const ok=await h.invoke(endpoint,{title:'Beat',audioFileId:1,coverFileId:4,stemsFileId:5});
 assert.equal(ok.status,201);
 assert.equal(h.beats.size,1);
 assert.equal([...h.beats.values()][0].audio_file_id,1);
 const duplicate=await h.invoke(endpoint,{title:'Beat again',audioFileId:1});
 assert.equal(duplicate.status,200);
 assert.equal(duplicate.data.reused,true);
 assert.equal(duplicate.data.id,ok.data.id);
 assert.equal(h.beats.size,1);
 assert.equal(h.stored.sends,0);
 assert.ok(h.queries.some(x=>x.sql.startsWith('SELECT pg_advisory_xact_lock')));
});

test('pack linking refuses other-owner beats and covers, then hides only newly uploaded beats',async()=>{
 const h=fixture();
 h.beats.set(beatA,{id:beatA,user_id:42,library_visible:true});
 h.beats.set(beatB,{id:beatB,user_id:99,library_visible:true});
 const path='/api/library/files/packs',ids=[beatA,beatB];
 const denied=await h.invoke(path,{title:'Pack',beatIds:ids,newBeatIds:[beatA]});
 assert.equal(denied.status,403);
 assert.equal(h.packs.length,0);
 h.beats.get(beatB).user_id=42;
 const deniedCover=await h.invoke(path,{title:'Pack',beatIds:ids,newBeatIds:[beatB],coverFileId:2});
 assert.equal(deniedCover.status,403);
 assert.equal(h.packs.length,0);
 const ok=await h.invoke(path,{title:'Pack',beatIds:ids,newBeatIds:[beatB],coverFileId:4});
 assert.equal(ok.status,201);
 assert.equal(h.packs.length,1);
 assert.deepEqual(h.members.map(m=>({beat:m.beat,position:m.position})),[
  {beat:beatA,position:0},{beat:beatB,position:1}
 ]);
 assert.equal(h.beats.get(beatA).library_visible,true);
 assert.equal(h.beats.get(beatB).library_visible,false);
 assert.equal(h.stored.sends,0);
});

test('existing trashed beat cannot be recreated using the same audio reference',async()=>{
 const h=fixture();
 h.beats.set(beatA,{id:beatA,user_id:42,audio_file_id:1,deleted_at:new Date().toISOString()});
 const res=await h.invoke('/api/library/files/beats',{title:'Recreate',audioFileId:1});
 assert.equal(res.status,409);
 assert.match(res.data.error,/Restore it first/);
 assert.equal(h.beats.size,1);
 assert.equal(h.queries.filter(x=>x.sql.startsWith('INSERT INTO library_beats')).length,0);
 assert.ok(h.queries.some(x=>x.sql==='COMMIT'));
});
