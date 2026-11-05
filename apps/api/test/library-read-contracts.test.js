// Characterization tests for the EXISTING private /api/library/files GET API.
// These are intentionally read-only; no PostgreSQL connection, R2 credentials,
// uploads, mutations, signed URLs or production users are involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {handleLibraryFiles} from '../dist/library-files.js';

const ownerA=42,ownerB=99;
const beatA='11111111-1111-4111-8111-111111111111';
const beatB='22222222-2222-4222-8222-222222222222';
const packA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const original=Buffer.from('12345678');

function fixture(){
 const queries=[],storageCommands=[];
 const files=[
  {id:11,user_id:ownerA,kind:'audio',status:'ready',original_name:'original.mp3',content_type:'audio/mpeg',byte_size:original.length,created_at:'2026-01-01'},
  {id:12,user_id:ownerA,kind:'cover',status:'ready',original_name:'art.png',content_type:'image/png',byte_size:original.length,created_at:'2026-01-01'},
  {id:13,user_id:ownerA,kind:'stems',status:'ready',original_name:'stems.zip',content_type:'application/zip',byte_size:original.length,created_at:'2026-01-01'},
  {id:14,user_id:ownerA,kind:'audio',status:'pending',original_name:'incomplete.mp3',content_type:'audio/mpeg',byte_size:original.length,created_at:'2026-01-01'},
  {id:21,user_id:ownerB,kind:'audio',status:'ready',original_name:'foreign.mp3',content_type:'audio/mpeg',byte_size:original.length,created_at:'2026-01-01'}
 ];
 const beats=[
  {id:beatA,user_id:ownerA,title:'First',audio_file_id:11,cover_file_id:12,stems_file_id:13,library_visible:true},
  {id:beatB,user_id:ownerB,title:'Foreign',audio_file_id:21,cover_file_id:null,stems_file_id:null,library_visible:true}
 ];
 const packs=[{id:packA,user_id:ownerA,title:'Pack A',cover_file_id:12,track_count:1}];
 const result=rows=>({rows,rowCount:rows.length});
 const db={
  async query(sql,args=[]){
   queries.push({sql,args});
   if(sql.includes('FROM library_packs p JOIN library_pack_beats pb')){
    assert.match(sql,/p.user_id=\$2/,'pack tracks must be owner-scoped');
    assert.match(sql,/ORDER BY pb.position ASC/,'pack order is meaningful');
    assert.match(sql,/p.deleted_at IS NULL AND b.deleted_at IS NULL/);
    const matching=args[0]===packA&&args[1]===ownerA;
    return result(matching?[{id:beatA,title:'First',audio_file_id:11,cover_file_id:12,stems_file_id:13}]:[]);
   }
   if(sql.includes('FROM library_beats b JOIN library_files audio')){
    assert.match(sql,/b.user_id=\$2/);
    assert.match(sql,/audio.user_id=b.user_id/);
    assert.match(sql,/audio.status='ready'/);
    return result(beats.filter(b=>b.id===args[0]&&b.user_id===args[1]).map(b=>({id:b.id,title:b.title,audio_file_id:b.audio_file_id,stems_file_id:b.stems_file_id})));
   }
   if(sql.includes('FROM library_beats b JOIN library_files a')){
    assert.match(sql,/b.user_id=\$1 AND b.deleted_at IS NULL/);
    assert.match(sql,/a.status='ready'/);
    return result(beats.filter(b=>b.user_id===args[0]).map(b=>({...b,audio_name:'original.mp3',audio_size:original.length,pack_count:b.user_id===ownerA?1:0})));
   }
   if(sql.includes('FROM library_packs p LEFT JOIN')){
    assert.match(sql,/p.user_id=\$1 AND p.deleted_at IS NULL/);
    return result(packs.filter(p=>p.user_id===args[0]));
   }
   if(sql.includes('FROM library_files f')){
    assert.match(sql,/f.user_id=\$2 AND f.kind=\$3 AND f.status='ready'/);
    const row=files.find(f=>f.id===Number(args[0])&&f.user_id===args[1]&&f.kind===args[2]&&f.status==='ready');
    return result(row?[{object_key:'users/'+row.user_id+'/assets/'+row.kind+'/verified',content_type:row.content_type,byte_size:row.byte_size}]:[]);
   }
   if(sql.includes('FROM library_files WHERE user_id=$1 AND status=\'ready\'')){
    return result(files.filter(f=>f.user_id===args[0]&&f.status==='ready').map(({id,kind,original_name,content_type,byte_size,created_at})=>({id,kind,original_name,content_type,byte_size,created_at})));
   }
   throw Error('Unexpected library read SQL: '+sql);
  }
 };
 const s3={async send(command){
  storageCommands.push({kind:command.constructor.name,input:command.input});
  if(command.constructor.name!=='GetObjectCommand')throw Error('Read API must never write to storage');
  const match=/^bytes=(\d+)-(\d+)$/.exec(command.input.Range||'');
  const bytes=match?original.subarray(Number(match[1]),Number(match[2])+1):original;
  return {Body:Readable.from([bytes])};
 }};
 async function invoke(path,{viewer=ownerA,method='GET',range}={}){
  const request=Readable.from([]);
  request.method=method;
  request.headers=range?{range}:{};
  const response={
   status:0,headers:{},parts:[],
   writeHead(code,headers={}){this.status=code;this.headers=headers;},
   write(chunk){this.parts.push(Buffer.from(chunk));},
   end(chunk){if(chunk)this.parts.push(Buffer.from(chunk));}
  };
  const handled=await handleLibraryFiles(request,response,path,db,async()=>viewer===null?null:{id:viewer},{
   storageFactory:()=>({s3,bucket:'unit-test-only'})
  });
  const bytes=Buffer.concat(response.parts);
  return {handled,status:response.status,headers:response.headers,bytes,body:()=>{
   try{return JSON.parse(bytes.toString('utf8'));}catch{return null;}
  }};
 }
 return {invoke,queries,storageCommands};
}

test('dispatcher rejects non-library paths, unsupported methods and anonymous reads before storage/SQL',async()=>{
 const f=fixture();
 assert.equal((await f.invoke('/health')).handled,false);
 const disallowed=await f.invoke('/api/library/files/items',{method:'DELETE'});
 assert.equal(disallowed.status,405);
 assert.equal(disallowed.headers['Cache-Control'],'no-store');
 assert.deepEqual(disallowed.body(),{error:'Method not allowed'});
 const unauth=await f.invoke('/api/library/files/items',{viewer:null});
 assert.equal(unauth.status,401);
 assert.deepEqual(unauth.body(),{error:'Not authenticated'});
 assert.equal(f.queries.length,0);
 assert.equal(f.storageCommands.length,0);
});

test('owner GET items returns the exact existing response shape and never includes the other viewer',async()=>{
 const f=fixture();
 const a=await f.invoke('/api/library/files/items');
 const b=await f.invoke('/api/library/files/items',{viewer:ownerB});
 assert.equal(a.status,200);assert.equal(b.status,200);
 assert.equal(a.headers['Cache-Control'],'no-store');
 assert.deepEqual(a.body().beats.map(x=>x.id),[beatA]);
 assert.deepEqual(a.body().packs.map(x=>x.id),[packA]);
 assert.deepEqual(b.body().beats.map(x=>x.id),[beatB]);
 assert.deepEqual(b.body().packs,[]);
 assert.deepEqual(f.queries.filter(q=>/FROM library_beats b JOIN library_files a/.test(q.sql)).map(x=>x.args),[[ownerA],[ownerB]]);
 assert.deepEqual(f.queries.filter(q=>/FROM library_packs p LEFT JOIN/.test(q.sql)).map(x=>x.args),[[ownerA],[ownerB]]);
 assert.equal(f.storageCommands.length,0,'listing must not download R2 objects');
});

test('pack-tracks and beat metadata honor original owner and preserve existing response contracts',async()=>{
 const f=fixture();
 const tracks=await f.invoke('/api/library/files/pack-tracks/'+packA);
 assert.equal(tracks.status,200);
 assert.deepEqual(tracks.body().beats.map(x=>x.id),[beatA]);
 assert.equal(tracks.body().beats[0].stems_file_id,13);
 const foreign=await f.invoke('/api/library/files/pack-tracks/'+packA,{viewer:ownerB});
 assert.equal(foreign.status,200,'existing contract: unknown pack appears as empty tracks');
 assert.deepEqual(foreign.body(),{beats:[]});
 const beat=await f.invoke('/api/library/files/beat/'+beatA);
 assert.equal(beat.status,200);
 assert.deepEqual(beat.body(),{beat:{id:beatA,title:'First',audio_file_id:11,stems_file_id:13}});
 const denied=await f.invoke('/api/library/files/beat/'+beatA,{viewer:ownerB});
 assert.equal(denied.status,404);
 assert.deepEqual(denied.body(),{error:'Beat not found'});
 assert.equal(f.storageCommands.length,0);
});

test('raw file metadata listing is READY-only and never returns storage object keys',async()=>{
 const f=fixture();
 const a=await f.invoke('/api/library/files');
 const b=await f.invoke('/api/library/files',{viewer:ownerB});
 assert.equal(a.status,200);
 assert.deepEqual(a.body().files.map(x=>x.id),[11,12,13]);
 assert.deepEqual(b.body().files.map(x=>x.id),[21]);
 assert.equal(a.body().files.some(x=>'object_key' in x),false);
 assert.equal(f.storageCommands.length,0);
});

test('owner cover and audio access use authorized original R2 bytes; foreign file IDs cannot read storage',async()=>{
 const f=fixture();
 const cover=await f.invoke('/api/library/files/cover/12');
 assert.equal(cover.status,200);
 assert.equal(cover.headers['Content-Type'],'image/png');
 assert.equal(cover.headers['Cache-Control'],'private, max-age=300');
 assert.equal(cover.headers['X-Content-Type-Options'],'nosniff');
 assert.deepEqual(cover.bytes,original);
 const audio=await f.invoke('/api/library/files/audio/11',{range:'bytes=2-4'});
 assert.equal(audio.status,206);
 assert.equal(audio.headers['Content-Range'],'bytes 2-4/8');
 assert.equal(audio.headers['Cache-Control'],'private, no-store');
 assert.equal(audio.bytes.toString(),'345');
 const calls=f.storageCommands.length;
 assert.equal((await f.invoke('/api/library/files/cover/12',{viewer:ownerB})).status,404);
 assert.equal((await f.invoke('/api/library/files/audio/11',{viewer:ownerB})).status,404);
 assert.equal((await f.invoke('/api/library/files/stems/13',{viewer:ownerB})).status,404);
 assert.equal(f.storageCommands.length,calls,'foreign media must not trigger R2 GET');
});

test('invalid byte range and invalid read route do not stream objects',async()=>{
 const f=fixture();
 const range=await f.invoke('/api/library/files/audio/11',{range:'bytes=999-'});
 assert.equal(range.status,416);
 assert.equal(range.headers['Content-Range'],'bytes */8');
 assert.equal(range.headers['Cache-Control'],'private, no-store');
 const missing=await f.invoke('/api/library/files/does-not-exist');
 assert.equal(missing.status,404);
 assert.equal(missing.headers['Cache-Control'],'no-store');
 assert.deepEqual(missing.body(),{error:'Not found'});
 assert.equal(f.storageCommands.length,0);
});
