import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeLibraryProjectsV2,normalizePackTracksV2,normalizeProfileProjectsV2,sameProjectV2} from '../src/project-read-v2.ts';

const source=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const library=source('library-items-v2.tsx');
const profile=source('public-profile-v2.tsx');
const flags=source('project-flags-v2.tsx');
const menu=source('project-context-menu-v2.tsx');

test('library read adapters keep original IDs, original owner, optional cover and stems, and visibility',()=>{
 const data=normalizeLibraryProjectsV2({
  beats:[{id:'beat-1',title:'First',audio_file_id:12,cover_file_id:null,stems_file_id:null,pack_count:2,library_visible:false,created_at:'2026-11-02'},
   {id:'beat-2',title:'Second',audio_file_id:'13',cover_file_id:'18',stems_file_id:21},
   {id:'invalid',title:'No audio'},{id:'wrong',audio_file_id:12,owner_id:99,title:'Server row'}],
  packs:[{id:'pack-1',title:'A pack',cover_file_id:null,track_count:2},{id:'pack-2',title:'No art',cover_file_id:44,track_count:0}]
 },4);
 assert.equal(data.beats.length,3);
 assert.deepEqual(data.beats[0],{
  ownerId:4,kind:'beat',projectId:'beat-1',id:'beat-1',owner_id:4,title:'First',
  audio_file_id:12,cover_file_id:null,stems_file_id:null,pack_count:2,
  created_at:'2026-11-02',library_visible:false
 });
 assert.equal(data.beats[1].audio_file_id,13);
 assert.equal(data.beats[1].cover_file_id,18);
 assert.equal(data.beats[1].stems_file_id,21);
 assert.equal(data.beats[2].ownerId,4);
 assert.equal(data.beats[2].owner_id,4);
 assert.equal(data.packs[0].track_count,2);
 assert.equal(data.packs[1].cover_file_id,44);
 assert.deepEqual(normalizeLibraryProjectsV2({beats:[{id:'x',audio_file_id:1}]},0),{beats:[],packs:[]});
});

test('pack tracks preserve server member order and use original cover first, pack cover only as fallback',()=>{
 const pack={owner_id:8,cover_file_id:44};
 const tracks=normalizePackTracksV2({beats:[
  {id:'member-3',title:'Last',audio_file_id:3,cover_file_id:null},
  {id:'member-1',title:'First',audio_file_id:1,cover_file_id:33},
  {id:'member-2',title:'Middle',audio_file_id:2,cover_file_id:null}
 ]},pack);
 assert.deepEqual(tracks.map(t=>t.id),['member-3','member-1','member-2']);
 assert.deepEqual(tracks.map(t=>t.cover_file_id),[44,33,44]);
 assert.ok(tracks.every(t=>t.owner_id===8&&t.ownerId===8));
 assert.equal(tracks[0].stems_file_id,null);
 assert.deepEqual(normalizePackTracksV2({beats:null},pack),[]);
});

test('profile Catalog and Saves normalize per original owner, not viewing account',()=>{
 const data=normalizeProfileProjectsV2({
  catalog:[{id:'a',kind:'beat',owner_id:9,title:'A',cover_file_id:null},
   {id:'pack-a',kind:'pack',owner_id:9,title:'P',track_count:3,cover_file_id:42}],
  saves:[{id:'a',kind:'beat',owner_id:9,title:'A',cover_file_id:null},
   {id:'a',kind:'beat',owner_id:18,title:'Other owner',cover_file_id:100},
   {id:'bogus',kind:'video',owner_id:9,title:'Unknown'},
   {id:'missing-owner',kind:'beat',title:'Missing owner'}]
 });
 assert.equal(data.catalog.length,2);
 assert.equal(data.saves.length,2);
 assert.equal(data.catalog[0].track_count,null);
 assert.equal(data.catalog[1].track_count,3);
 assert.equal(data.saves[1].ownerId,18);
 assert.equal(data.saves[1].projectId,'a');
 assert.ok(!sameProjectV2(data.saves[0],data.saves[1]));
 assert.ok(sameProjectV2(data.catalog[0],data.saves[0]));
 assert.deepEqual(normalizeProfileProjectsV2(null),{catalog:[],saves:[]});
});

test('views share adapters, scoped invalidations and no F5 to retry',()=>{
 assert.match(library,/normalizeLibraryProjectsV2\(body,Number\(userId\)\)/);
 assert.match(library,/normalizePackTracksV2\(result,pack\)/);
 assert.match(profile,/normalizeProfileProjectsV2\(result\)/);
 assert.match(profile,/requestKey=String\(user\?\.id\|\|'anonymous'\)\+':'\+targetId/);
 assert.match(profile,/profileStatus==='ready'\?projects:/);
 assert.match(library,/setLibraryRevision\(v=>v\+1\)/);
 assert.match(profile,/setRefreshRevision\(v=>v\+1\)/);
 assert.doesNotMatch(library,/window\.location\.reload\(\)/);
 assert.match(library,/controller\.abort\(\)/);
 assert.match(profile,/controller\.abort\(\)/);
 assert.match(library,/packRequest\.current\?\.abort\(\)/);
});

test('Save and Publish remain disabled before a verified viewer-scoped flags read',()=>{
 assert.match(flags,/status:ProjectFlagsStatusV2/);
 assert.match(flags,/const saved=status==='ready'\?flags\.saved:EMPTY_SAVED/);
 assert.match(flags,/const published=status==='ready'\?flags\.published:EMPTY_PUBLISHED/);
 assert.match(flags,/if\(status!=='ready'\)throw Error/);
 assert.match(flags,/controller\.signal\.aborted\|\|activeViewer\.current!==id/);
 assert.match(flags,/setFlags\(\{\.\.\.normalizeViewerProjectFlagsV2/);
 assert.match(flags,/error:err instanceof Error/);
 assert.match(menu,/onSave,!onSave/);
 assert.match(menu,/onPublish,!onPublish/);
 assert.match(library,/disabled=\{flagsStatus!=='ready'\}/);
 assert.match(library,/flagsStatus==='ready'\?\(\)=>void togglePublish/);
 assert.match(profile,/flagsStatus==='ready'\?\(\)=>void publishProject/);
 assert.match(profile,/flagsStatus==='error'/);
});
