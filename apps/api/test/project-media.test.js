import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAuthorizedMediaFile} from '../src/project-media.js';

// An isolated, deterministic PG adapter. It evaluates the intended fixture
// relationships and captures the production queries without using R2 or v1.
// SQL execution against PostgreSQL is a separate integration-test gate.
function fixture({
 files=[{id:11,owner:1,kind:'audio',ready:true},{id:12,owner:1,kind:'cover',ready:true},{id:13,owner:1,kind:'stems',ready:true}],
 beats=[{id:'beat-a',owner:1,audio:11,cover:12,stems:13}],
 packs=[],published=[],grants=[]
}={}){
 const calls=[];
 return {
  calls,
  async query(sql,params){
   calls.push({sql,params});
   if(sql.startsWith('SELECT f.object_key')){
    const [id,owner,kind]=params;
    const f=files.find(x=>x.id===id&&x.owner===owner&&x.kind===kind&&x.ready);
    return {rowCount:f?1:0,rows:f?[{object_key:'users/'+owner+'/assets/'+kind+'/'+id,content_type:kind==='cover'?'image/png':'audio/mpeg',byte_size:2000}]:[]};
   }
   if(sql.startsWith('SELECT 1 FROM (')){
    const [id,owner,kind,viewer]=params;
    const linked=[
     ...beats.filter(x=>x.owner===owner&&(kind==='audio'&&x.audio===id||kind==='cover'&&x.cover===id)).map(x=>({kind:'beat',id:x.id})),
     ...packs.filter(x=>x.owner===owner&&kind==='cover'&&x.cover===id).map(x=>({kind:'pack',id:x.id})),
     ...packs.filter(p=>p.owner===owner&&beats.some(b=>
      b.owner===owner&&(p.beatIds||[]).includes(b.id)&&
      (kind==='audio'&&b.audio===id||kind==='cover'&&b.cover===id)
     )).map(x=>({kind:'pack',id:x.id}))
    ];
    const canRead=linked.some(p=>
     published.some(x=>x.owner===owner&&x.kind===p.kind&&x.id===p.id)||
     viewer!==null&&grants.some(x=>x.owner===owner&&x.viewer===viewer&&x.kind===p.kind&&x.id===p.id)
    );
    return {rowCount:canRead?1:0,rows:canRead?[{'?column?':1}]:[]};
   }
   throw Error('Unexpected SQL query: '+sql.slice(0,60));
  }
 };
}
const read=(pool,kind,fileId,viewerId=null,ownerId=1)=>
 resolveAuthorizedMediaFile(pool,{ownerId,viewerId,fileId,kind});

test('owner reads original audio, cover and stems through one resolver',async()=>{
 const pool=fixture();
 for(const [kind,id] of [['audio',11],['cover',12],['stems',13]]){
  const media=await read(pool,kind,id,1);
  assert.equal(media?.object_key,'users/1/assets/'+kind+'/'+id);
 }
 assert.equal(pool.calls.length,3);
 assert.ok(pool.calls.every(call=>call.sql.includes("f.status='ready'")));
});

test('owner can still read an unattached, ready upload during compatibility migration',async()=>{
 const pool=fixture({files:[{id:44,owner:1,kind:'cover',ready:true}],beats:[]});
 assert.ok(await read(pool,'cover',44,1));
 assert.equal(pool.calls.length,1);
});

test('anonymous visitors may read linked published audio and cover, not private media',async()=>{
 const pool=fixture({published:[{owner:1,kind:'beat',id:'beat-a'}]});
 assert.ok(await read(pool,'audio',11));
 assert.ok(await read(pool,'cover',12));
 assert.equal(pool.calls[1].params[3],null);
 const privatePool=fixture();
 assert.equal(await read(privatePool,'cover',12),null);
});

test('an authorized recipient can read a shared private beat, other visitors cannot',async()=>{
 const pool=fixture({grants:[{owner:1,viewer:2,kind:'beat',id:'beat-a'}]});
 assert.ok(await read(pool,'cover',12,2));
 assert.ok(await read(pool,'audio',11,2));
 assert.equal(await read(pool,'cover',12,3),null);
});

test('a save relationship alone is not a grant',async()=>{
 const pool=fixture();
 assert.equal(await read(pool,'audio',11,2),null);
 assert.equal(await read(pool,'cover',12,2),null);
});

test('stems remain owner-only pending explicit product policy, even for published/shared beats',async()=>{
 const pool=fixture({published:[{owner:1,kind:'beat',id:'beat-a'}],grants:[{owner:1,viewer:2,kind:'beat',id:'beat-a'}]});
 assert.equal(await read(pool,'stems',13,2),null);
 assert.equal(await read(pool,'stems',13),null);
 assert.ok(await read(pool,'stems',13,1));
 assert.equal(pool.calls.filter(c=>c.sql.startsWith('SELECT 1 FROM (')).length,0);
});

test('published pack cover is permitted, but an unrelated cover is not',async()=>{
 const pool=fixture({
  files:[{id:20,owner:1,kind:'cover',ready:true},{id:21,owner:1,kind:'cover',ready:true}],
  beats:[],
  packs:[{id:'pack-a',owner:1,cover:20}],
  published:[{owner:1,kind:'pack',id:'pack-a'}]
 });
 assert.ok(await read(pool,'cover',20));
 assert.equal(await read(pool,'cover',21),null);
});

test('a published pack grants playback and cover of member beats without publishing those beats',async()=>{
 const pool=fixture({
  packs:[{id:'pack-a',owner:1,cover:20,beatIds:['beat-a']}],
  published:[{owner:1,kind:'pack',id:'pack-a'}]
 });
 assert.ok(await read(pool,'audio',11));
 assert.ok(await read(pool,'cover',12));
 assert.equal(await read(pool,'stems',13),null);
 assert.ok(pool.calls.some(c=>c.sql.includes('JOIN library_pack_beats pb')));
});

test('a private pack share grants only authorized recipients its member media',async()=>{
 const pool=fixture({
  packs:[{id:'pack-a',owner:1,beatIds:['beat-a']}],
  grants:[{owner:1,viewer:2,kind:'pack',id:'pack-a'}]
 });
 assert.ok(await read(pool,'audio',11,2));
 assert.ok(await read(pool,'cover',12,2));
 assert.equal(await read(pool,'audio',11,3),null);
});

test('owner, file type, missing file and readiness are checked before access grants',async()=>{
 const pool=fixture({files:[{id:12,owner:1,kind:'cover',ready:false}]});
 assert.equal(await read(pool,'cover',12,1),null);
 assert.equal(await read(pool,'audio',12,1),null);
 assert.equal(await read(pool,'cover',12,1,2),null);
 assert.equal(pool.calls.length,3);
});

test('invalid identifiers and unknown file kinds never reach the database',async()=>{
 const pool=fixture();
 assert.equal(await read(pool,'cover','1 OR 1=1',1),null);
 assert.equal(await read(pool,'cover',-1,1),null);
 assert.equal(await read(pool,'video',12,1),null);
 assert.equal(await read(pool,'cover',12,1,'not-an-id'),null);
 assert.equal(pool.calls.length,0);
});

test('authorization SQL ties access to project identity rather than saved flags or bare file IDs',async()=>{
 const pool=fixture({published:[{owner:1,kind:'beat',id:'beat-a'}]});
 await read(pool,'cover',12,2);
 const authSql=pool.calls[1].sql;
 for(const name of ['library_beats','library_packs','v2_public_projects','v2_project_access','project_id','cover_file_id','audio_file_id']){
  assert.ok(authSql.includes(name),'missing authorization condition: '+name);
 }
 assert.ok(!authSql.includes('v2_public_saves'));
 assert.deepEqual(pool.calls[1].params,[12,1,'cover',2]);
});
