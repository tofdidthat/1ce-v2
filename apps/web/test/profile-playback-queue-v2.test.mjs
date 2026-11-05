import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appendDistinctQueueV2,upcomingQueueV2,queueTrackKeyV2,tracksFromPlayableProjectV2} from '../src/playback-queue-v2.ts';

const make=(owner_id,id)=>({owner_id,id,cover_file_id:null,audio_file_id:11,title:id});
test('multiple Add to queue actions cannot duplicate a track; owners with same track ID remain distinct',()=>{
 const a=make(1,'same'),b=make(2,'same'),c=make(1,'next');
 const result=appendDistinctQueueV2([a], [a,b,b,c,a]);
 assert.deepEqual(result,[a,b,c]);
 assert.equal(result[0],a);
 assert.equal(queueTrackKeyV2(a),'1:same');
 assert.notEqual(queueTrackKeyV2(a),queueTrackKeyV2(b));
});
test('the now-playing track is separate from the upcoming queue',()=>{
 const a=make(1,'a'),b=make(1,'b'),c=make(2,'c');
 const playlist=[a,b,c];
 assert.deepEqual(upcomingQueueV2(playlist,a),[b,c]);
 assert.deepEqual(upcomingQueueV2(playlist,b),[c]);
 assert.deepEqual(upcomingQueueV2(playlist,c),[]);
 assert.deepEqual(upcomingQueueV2(playlist,null),playlist);
});
test('validated pack tracks preserve ownership, order, audio IDs and cover fallback',()=>{
 const project={id:'pack-1',owner_id:19,kind:'pack',title:'Pack',cover_file_id:55,tracks:[
  {id:'beat-b',owner_id:19,title:'B',audio_file_id:24,cover_file_id:null,stems_file_id:null},
  {id:'beat-a',owner_id:19,title:'A',audio_file_id:21,cover_file_id:56,stems_file_id:null}
 ]};
 const tracks=tracksFromPlayableProjectV2(project);
 assert.deepEqual(tracks.map(x=>x.id),['beat-b','beat-a']);
 assert.deepEqual(tracks.map(x=>x.audio_file_id),[24,21]);
 assert.deepEqual(tracks.map(x=>x.cover_file_id),[55,56]);
 assert.deepEqual(tracks.map(x=>x.owner_id),[19,19]);
 assert.throws(()=>tracksFromPlayableProjectV2({...project,tracks:[project.tracks[0],{...project.tracks[1],audio_file_id:0}]}),/Invalid playable project tracks/);
});
test('Profile play, queue and the independent player use the same source-backed path',()=>{
 const src=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
 const player=src('library-items-v2.tsx'),dock=src('player-dock-v2.tsx'),profile=src('public-profile-v2.tsx');
 assert.match(profile,/onPlay=\{onPlayProject\?\(\)=>onPlayProject\(project.owner_id,project.kind,project.id\)/);
 assert.match(player,/const project=await fetchPlayableProjectV2\(ownerId,kind,id,controller.signal\)/);
 assert.match(player,/tracksFromPlayableProjectV2\(project\)/);
 assert.match(player,/createPortal\(<div className="onece-player-dock/);
 assert.match(player,/createPortal\(<audio ref=\{audioRef\}/);
 assert.match(dock,/upcomingQueueV2\(queue,current\)\.map/);
 assert.doesNotMatch(player,/setQueue\(previous=>\[\.\.\.previous,\.\.\.tracks\]\)/);
});
