import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePlayableProject} from '../src/project-media.js';

const beatId='bbf80bde-7b6a-4b18-8b1f-4e52eb98f776';
const extraBeatId='aa01aa01-7b6a-4b18-8b1f-4e52eb98f776';
const packId='e2c0e2e6-2e40-4cdf-a207-1ba6cc66cc2a';
function fixture({published=[],grants=[],saves=[],ready=true,cover=12,stems=13}={}){
 const calls=[];
 const beats=[
  {id:beatId,title:'Original beat',user_id:1,owner_id:1,audio_file_id:11,cover_file_id:cover,stems_file_id:stems},
  {id:extraBeatId,title:'Original second beat',user_id:1,owner_id:1,audio_file_id:21,cover_file_id:null,stems_file_id:null}
 ];
 const packs=[{id:packId,title:'Original pack',user_id:1,owner_id:1,cover_file_id:30,beatIds:[beatId,extraBeatId]}];
 function allowed(kind,id,viewer){
  return viewer===1||published.some(p=>p.kind===kind&&p.id===id)||
   (viewer!=null&&(grants.some(g=>g.kind===kind&&g.id===id&&g.viewer===viewer)||
      saves.some(s=>s.kind===kind&&s.id===id&&s.saver===viewer)));
 }
 return {calls,async query(sql,args){
  calls.push({sql,args});
  if(sql.includes('FROM library_beats b')&&sql.includes('JOIN library_files file')){
   const [owner,id,viewer]=args;
   const beat=beats.find(b=>b.id===id&&b.user_id===owner);
   const match=ready&&beat&&allowed('beat',id,viewer);
   return {rowCount:match?1:0,rows:match?[{...beat,stems_file_id:viewer===owner?beat.stems_file_id:null}]:[]};
  }
  if(sql.includes('FROM library_packs p')&&sql.includes('WHERE p.user_id=')){
   const [owner,id,viewer]=args;
   const pack=packs.find(p=>p.id===id&&p.user_id===owner&&allowed('pack',id,viewer));
   return {rowCount:pack?1:0,rows:pack?[pack]:[]};
  }
  if(sql.includes('FROM library_pack_beats pb')){
   const [id,owner,viewer]=args;
   const pack=packs.find(p=>p.id===id&&p.user_id===owner);
   const rows=ready&&pack?pack.beatIds.map(memberId=>beats.find(b=>b.id===memberId))
    .filter(Boolean).map(b=>({...b,stems_file_id:viewer===owner?b.stems_file_id:null})):[];
   return {rowCount:rows.length,rows};
  }
  throw Error('Unexpected SQL '+sql.slice(0,100));
 }};
}
const resolve=(pool,kind,projectId,viewerId=null)=>resolvePlayableProject(pool,{ownerId:1,viewerId,kind,projectId});

test('owner and published visitors resolve one canonical playable beat',async()=>{
 const pool=fixture({published:[{kind:'beat',id:beatId}]});
 const project=await resolve(pool,'beat',beatId);
 assert.equal(project.owner_id,1);
 assert.equal(project.id,beatId);
 assert.equal(project.kind,'beat');
 assert.deepEqual(project.tracks.map(t=>t.id),[beatId]);
 assert.equal(project.tracks[0].audio_file_id,11);
 assert.equal(project.tracks[0].stems_file_id,null);
 assert.ok(!JSON.stringify(project).includes('object_key'));
 const sql=pool.calls[0].sql;
 for(const constraint of ['v2_public_projects','v2_project_access',"file.status='ready'","file.user_id=b.user_id"]){
  assert.ok(sql.includes(constraint),'Missing authorization SQL: '+constraint);
 }
 const owner=await resolve(pool,'beat',beatId,1);
 assert.equal(owner.tracks[0].stems_file_id,13);
});
test('private projects are denied to strangers without their own save or grant',async()=>{
 const pool=fixture();
 assert.equal(await resolve(pool,'beat',beatId,2),null);
 assert.equal(await resolve(pool,'pack',packId,2),null);
 assert.equal(await resolve(pool,'beat',beatId),null);
 assert.equal(pool.calls.length,3);
 assert.ok(pool.calls.some(c=>c.sql.includes('v2_public_saves')));
});
test('private beat remains playable to the saver, not a third party, after Unpublish',async()=>{
 const pool=fixture({saves:[{kind:'beat',id:beatId,saver:2}]});
 const saved=await resolve(pool,'beat',beatId,2);
 assert.equal(saved?.id,beatId);
 assert.equal(saved.tracks[0].audio_file_id,11);
 assert.equal(saved.tracks[0].stems_file_id,null);
 assert.equal(await resolve(pool,'beat',beatId,3),null);
 assert.equal(await resolve(pool,'beat',beatId),null);
 assert.match(pool.calls[0].sql,/v2_public_saves saved/);
 assert.match(pool.calls[0].sql,/saved\.user_id=\$3/);
});

test('saving an unpublished pack does not directly publish member beats',async()=>{
 const pool=fixture({saves:[{kind:'pack',id:packId,saver:2}]});
 const pack=await resolve(pool,'pack',packId,2);
 assert.deepEqual(pack.tracks.map(track=>track.id),[beatId,extraBeatId]);
 assert.equal(await resolve(pool,'beat',beatId,2),null);
 assert.equal(await resolve(pool,'pack',packId,3),null);
});

test('explicit share grants the original beat, not its R2 stems',async()=>{
 const pool=fixture({grants:[{kind:'beat',id:beatId,viewer:2}]});
 assert.equal((await resolve(pool,'beat',beatId,2)).tracks[0].audio_file_id,11);
 assert.equal((await resolve(pool,'beat',beatId,2)).tracks[0].stems_file_id,null);
 assert.equal(await resolve(pool,'beat',beatId,3),null);
});
test('published pack retains ordered original member references without publishing beats',async()=>{
 const pool=fixture({published:[{kind:'pack',id:packId}]});
 const pack=await resolve(pool,'pack',packId,2);
 assert.equal(pack.id,packId);
 assert.equal(pack.cover_file_id,30);
 assert.deepEqual(pack.tracks.map(t=>t.id),[beatId,extraBeatId]);
 assert.deepEqual(pack.tracks.map(t=>t.audio_file_id),[11,21]);
 assert.equal(pack.tracks[1].cover_file_id,null);
 assert.equal(pack.tracks[0].stems_file_id,null);
 assert.equal(await resolve(pool,'beat',beatId,2),null,'Published pack must not publish the beat');
 assert.ok(pool.calls.at(-2).sql.includes('ORDER BY pb.position ASC'));
});
test('shared pack is playable only for authorized recipient',async()=>{
 const pool=fixture({grants:[{kind:'pack',id:packId,viewer:2}]});
 assert.equal((await resolve(pool,'pack',packId,2)).tracks.length,2);
 assert.equal(await resolve(pool,'pack',packId,3),null);
});
test('invalid and nonexistent references never expose private media',async()=>{
 const pool=fixture({ready:false});
 assert.equal(await resolve(pool,'beat',beatId,1),null);
 assert.equal(await resolve(pool,'beat','not-uuid',1),null);
 assert.equal(await resolvePlayableProject(pool,{ownerId:'1 OR 1=1',kind:'beat',projectId:beatId,viewerId:1}),null);
 assert.equal(pool.calls.length,1);
});
