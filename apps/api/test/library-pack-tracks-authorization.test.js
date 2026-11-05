// Security characterization: one SQL snapshot must distinguish an owned empty
// pack from an inaccessible pack and must never return foreign/unready assets.
// This fake database evaluates ownership predicates without real PostgreSQL/R2.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {handleLibraryFiles} from '../dist/library-files.js';

const OWNER=42,OTHER=99;
const packA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const packOther='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const packEmpty='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const packDeleted='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const packMissing='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ids=Array.from({length:7},(_,i)=>String(i+1).repeat(8)+'-'+String(i+1).repeat(4)+'-4'+String(i+1).repeat(3)+'-8'+String(i+1).repeat(3)+'-'+String(i+1).repeat(12));

function fixture(){
 const storageCalls=[],queries=[];
 const files=[
  {id:10,owner:OWNER,kind:'audio',status:'ready'},
  {id:11,owner:OWNER,kind:'cover',status:'ready'},
  {id:12,owner:OWNER,kind:'stems',status:'ready'},
  {id:20,owner:OWNER,kind:'audio',status:'ready'},
  {id:21,owner:OTHER,kind:'cover',status:'ready'},
  {id:22,owner:OTHER,kind:'stems',status:'ready'},
  {id:30,owner:OWNER,kind:'audio',status:'pending'},
  {id:99,owner:OTHER,kind:'audio',status:'ready'}
 ];
 const beats=[
  {id:ids[0],owner:OWNER,title:'First',audio:10,cover:11,stems:12},
  {id:ids[1],owner:OWNER,title:'Second',audio:20,cover:21,stems:22},
  {id:ids[2],owner:OWNER,title:'Foreign audio',audio:99,cover:null,stems:null},
  {id:ids[3],owner:OWNER,title:'Unready audio',audio:30,cover:null,stems:null},
  {id:ids[4],owner:OWNER,title:'Wrong file type',audio:11,cover:null,stems:null},
  {id:ids[5],owner:OTHER,title:'Foreign beat',audio:99,cover:null,stems:null},
  {id:ids[6],owner:OWNER,title:'Deleted beat',audio:10,cover:null,stems:null,deleted:true}
 ];
 const packs=[
  {id:packA,owner:OWNER},
  {id:packOther,owner:OTHER},
  {id:packEmpty,owner:OWNER},
  {id:packDeleted,owner:OWNER,deleted:true}
 ];
 const members=[
  {pack:packA,beat:ids[0],position:3},
  {pack:packA,beat:ids[1],position:0},
  {pack:packA,beat:ids[2],position:1},
  {pack:packA,beat:ids[3],position:2},
  {pack:packA,beat:ids[4],position:4},
  {pack:packA,beat:ids[5],position:5},
  {pack:packA,beat:ids[6],position:6}
 ];
 const ownedReady=(id,owner,kind)=>
  files.find(f=>f.id===id&&f.owner===owner&&f.kind===kind&&f.status==='ready');
 const db={async query(sql,args){
  queries.push({sql,args});
  // Guard the actual SQL rather than trusting the mock to invent permissions.
  for(const part of [
   'FROM library_packs p',
   'LEFT JOIN LATERAL (',
   'JOIN library_beats b ON b.id=pb.beat_id AND b.user_id=p.user_id AND b.deleted_at IS NULL',
   'JOIN library_files audio ON audio.id=b.audio_file_id',
   "audio.user_id=p.user_id AND audio.kind='audio' AND audio.status='ready'",
   'LEFT JOIN library_files cover ON cover.id=b.cover_file_id',
   "cover.user_id=p.user_id AND cover.kind='cover' AND cover.status='ready'",
   'LEFT JOIN library_files stems ON stems.id=b.stems_file_id',
   "stems.user_id=p.user_id AND stems.kind='stems' AND stems.status='ready'",
   'WHERE p.id=$1 AND p.user_id=$2 AND p.deleted_at IS NULL',
   'ORDER BY tracks.position ASC'
  ])assert.ok(sql.includes(part),'Missing server-side security condition: '+part);
  const pack=packs.find(p=>p.id===args[0]&&p.owner===args[1]&&!p.deleted);
  if(!pack)return {rows:[],rowCount:0};
  const matches=members.filter(m=>m.pack===pack.id).sort((a,b)=>a.position-b.position)
   .map(m=>beats.find(b=>b.id===m.beat))
   .filter(b=>b&&b.owner===pack.owner&&!b.deleted&&ownedReady(b.audio,pack.owner,'audio'))
   .map(b=>({
    pack_id:pack.id,id:b.id,title:b.title,audio_file_id:b.audio,
    cover_file_id:ownedReady(b.cover,pack.owner,'cover')?.id??null,
    stems_file_id:ownedReady(b.stems,pack.owner,'stems')?.id??null
   }));
  // A LEFT JOIN LATERAL emits one row for an existing pack with no members.
  const rows=matches.length?matches:[{pack_id:pack.id,id:null,title:null,audio_file_id:null,cover_file_id:null,stems_file_id:null}];
  return {rows,rowCount:rows.length};
 }};
 async function invoke(packId,{viewer=OWNER}={}){
  const req=Readable.from([]);req.method='GET';req.headers={};
  const response={status:0,headers:{},chunks:[],
   writeHead(status,headers={}){this.status=status;this.headers=headers;},
   end(body){if(body)this.chunks.push(Buffer.from(body));}
  };
  const used=await handleLibraryFiles(req,response,'/api/library/files/pack-tracks/'+packId,db,async()=>viewer===null?null:{id:viewer},{
   storageFactory:()=>({s3:{async send(command){storageCalls.push(command);throw Error('Unexpected storage request');}},bucket:'disposable-unit-test'})
  });
  const body=response.chunks.length?JSON.parse(Buffer.concat(response.chunks).toString()):null;
  return {used,status:response.status,headers:response.headers,body};
 }
 return {invoke,queries,storageCalls};
}

test('owned pack returns only its READY, same-owner audio tracks in saved position order',async()=>{
 const f=fixture();
 const response=await f.invoke(packA);
 assert.equal(response.used,true);
 assert.equal(response.status,200);
 assert.deepEqual(response.body,{beats:[
  {id:ids[1],title:'Second',audio_file_id:20,cover_file_id:null,stems_file_id:null},
  {id:ids[0],title:'First',audio_file_id:10,cover_file_id:11,stems_file_id:12}
 ]});
 assert.equal(response.headers['Cache-Control'],'no-store');
 assert.equal(f.queries.length,1,'One atomic SQL statement per pack read');
 assert.equal(f.storageCalls.length,0);
});

test('existing empty pack is 200, but missing, deleted and foreign pack IDs give the same private 404',async()=>{
 const f=fixture();
 assert.deepEqual((await f.invoke(packEmpty)).body,{beats:[]});
 assert.equal((await f.invoke(packEmpty)).status,200);
 for(const [path,viewer] of [[packMissing,OWNER],[packDeleted,OWNER],[packOther,OWNER],[packA,OTHER]]){
  const response=await f.invoke(path,{viewer});
  assert.equal(response.status,404,path);
  assert.deepEqual(response.body,{error:'Pack not found'},path);
  assert.equal(response.headers['Cache-Control'],'no-store');
 }
 assert.deepEqual((await f.invoke(packOther,{viewer:OTHER})).body,{beats:[]});
 assert.equal(f.storageCalls.length,0);
});

test('anonymous pack reads cannot query the database or access storage',async()=>{
 const f=fixture();
 const result=await f.invoke(packA,{viewer:null});
 assert.equal(result.status,401);
 assert.deepEqual(result.body,{error:'Not authenticated'});
 assert.equal(f.queries.length,0);
 assert.equal(f.storageCalls.length,0);
});

test('malformed 36-character pack UUIDs fail closed before PostgreSQL type casts',async()=>{
 const f=fixture();
 const malformed='f'.repeat(36); // Old loose ID check sent this to UUID casts (500).
 const response=await f.invoke(malformed);
 assert.equal(response.status,404);
 assert.deepEqual(response.body,{error:'Not found'});
 assert.equal(f.queries.length,0,'No SQL must receive an invalid pack UUID');
 assert.equal(f.storageCalls.length,0);
});
