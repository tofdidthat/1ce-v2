import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const workspace=source('workspace-v1.tsx');
const library=source('library-items-v2.tsx');
const profile=source('public-profile-v2.tsx');

test('C5 Home preserves the last viewer-verified cards during in-flight revalidation',()=>{
 assert.match(library,/const visibleData=loadedViewerId===Number\(userId\)\?data:/);
 assert.match(library,/loadedViewerId!==Number\(userId\)\?\(loading\|\|!error\?/);
 assert.doesNotMatch(library,/loading\|\|loadedViewerId!==Number\(userId\)\?/);
 assert.match(library,/\{error&&<div className="v2-library-status" role="alert">/);
 assert.match(library,/setError\(''\);setLoading\(true\)/);
 assert.match(library,/signal:controller\.signal/);
 assert.match(library,/return \(\)=>controller\.abort\(\)/);
});

test('C5 own profile remains mounted after first visit, hidden outside Profile without moving player',()=>{
 assert.match(workspace,/const \[recentProfiles,setRecentProfiles\]=useState/);
 assert.match(workspace,/const activeProfileKey=view==='profile'\?/);
 assert.match(workspace,/visibleProfileKeys\.map\(profileKey=><PublicProfileV2 key=/);
 assert.match(profile,/if\(!active\)return null;/);
 assert.match(workspace,/<LibraryItemsV2 active=\{view==='library'\}/);
 assert.match(workspace,/<ProjectCoverCacheProviderV2 viewerId=\{Number\(account\?\.id\)\|\|null\}/);
 assert.match(workspace,/<ProjectFlagsProviderV2 viewerId=\{Number\(account\?\.id\)\|\|null\}/);
});

test('C5 profile uses prior verified data only for the same viewer and target, with background refresh',()=>{
 assert.match(profile,/requestKey=String\(user\?\.id\|\|'anonymous'\)\+':'\+targetId/);
 assert.match(profile,/lastVerifiedProfileKey\.current===requestKey/);
 assert.match(profile,/profileStatus==='loading'&&!sameVerifiedProfile/);
 assert.match(profile,/profileStatus==='error'&&!sameVerifiedProfile/);
 assert.match(profile,/if\(active&&!previouslyActive\.current\)\{setRefreshRevision/);
 assert.match(profile,/if\(!active\)return;[\s\S]*?subscribeV2DataChanges\(\['library','saves','publications','shares','identity'\]/);
 assert.match(profile,/fetch\(api\+'\/api\/public\/profile\/'\+targetId,\{credentials:'include',signal:controller\.signal,cache:'no-store'\}\)/);
 assert.match(profile,/controller\.signal\.aborted/);
 assert.match(profile,/return\(\)=>controller\.abort\(\)/);
});

test('C5 same-view corrections do not introduce unsafe persistent storage or new media access paths',()=>{
 for(const s of [library,profile,workspace]){
  assert.doesNotMatch(s,/localStorage\.setItem\(['"](?:.*project|.*card|.*profile)/i);
  assert.doesNotMatch(s,/indexedDB\.open/);
 }
 assert.match(profile,/useProjectFlagsV2\(\)/);
 assert.match(profile,/ProjectCardV2 key=\{key\}/);
 assert.match(library,/ProjectCardV2 key=\{'pack-'\+p\.id\}/);
 assert.match(library,/ProjectCardV2 key=\{'beat-'\+b\.id\}/);
});
