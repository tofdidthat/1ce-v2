import test from 'node:test';
import assert from 'node:assert/strict';
import {isPublicProfileIdentityV2} from '../src/profile-identity-v2.ts';
import {parsePlayableProjectV2} from '../src/playable-manifest-v2.ts';

const uuid='123e4567-e89b-42d3-a456-426614174000';
const beat='123e4567-e89b-42d3-a456-426614174001';
const expected={ownerId:17,kind:'beat',id:uuid};
function manifest(){return {project:{id:uuid,owner_id:17,kind:'beat',title:'Session',cover_file_id:null,tracks:[
 {id:beat,owner_id:17,title:'First Beat',audio_file_id:30,cover_file_id:31,stems_file_id:200}
]}};}
test('public profile identity accepts only validated account metadata and HTTPS link strings',()=>{
 assert.equal(isPublicProfileIdentityV2({id:17,name:'Artist',username:'artist',links:['https://example.com']}),true);
 for(const profile of [null,{id:0,links:[]},{id:17,links:['ok',42]},{id:17,links:'https://example.com'},{id:17,has_avatar:'true'}])
  assert.equal(isPublicProfileIdentityV2(profile),false);
});
test('authorized playback manifest uses exactly the project and audio IDs from the API',()=>{
 const parsed=parsePlayableProjectV2(manifest(),expected);
 assert.equal(parsed.tracks[0].audio_file_id,30);
 assert.equal(parsed.tracks[0].id,beat);
 assert.equal(parsed.tracks[0].stems_file_id,null);
 assert.equal(parsed.cover_file_id,null);
});
test('playable manifest rejects malformed tracks instead of manufacturing file IDs',()=>{
 for(const replacement of [{audio_file_id:'30'},{audio_file_id:0},{owner_id:18},{title:42},{cover_file_id:'31'},{id:'wrong'}]){
  const invalid=manifest();
  Object.assign(invalid.project.tracks[0],replacement);
  assert.throws(()=>parsePlayableProjectV2(invalid,expected));
 }
 for(const invalid of [null,{}, {project:{...manifest().project,owner_id:18}}, {project:{...manifest().project,tracks:[]}}])
  assert.throws(()=>parsePlayableProjectV2(invalid,expected));
});
