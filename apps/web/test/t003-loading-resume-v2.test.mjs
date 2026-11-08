import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const flags=read('project-flags-v2.tsx');
const follows=read('use-profile-follows-v2.ts');
const world=read('world-v2.tsx');
const profile=read('public-profile-v2.tsx');
const library=read('library-items-v2.tsx');
const cache=read('project-cover-cache-v2.ts');

test('verified Save/Publish flags stay ready during same-viewer focus and data revalidation',()=>{
 assert.match(flags,/const sameViewer=previous\.viewerId===id/);
 assert.match(flags,/const keepVerified=sameViewer&&previous\.status==='ready'/);
 assert.match(flags,/status:keepVerified\?'ready':'loading'/);
 assert.match(flags,/saved:sameViewer\?previous\.saved:EMPTY_SAVED/);
 assert.match(flags,/published:sameViewer\?previous\.published:EMPTY_PUBLISHED/);
 // A different viewer still starts from an empty, loading state.
 assert.match(flags,/const status:ProjectFlagsStatusV2=!id\?'error':matchesViewer\?flags\.status:'loading'/);
});

test('Following keeps the same verified target while focus/tab revalidation runs',()=>{
 assert.match(follows,/previous\.key===followKey&&previous\.data/);
 assert.match(follows,/\?\{key:followKey,status:'ready',data:previous\.data\}/);
 assert.match(follows,/previous\.key===followKey&&previous\.data[\s\S]*?\{\.\.\.previous,status:'ready'\}/);
 assert.match(follows,/setFollowError\(caught instanceof Error\?caught\.message:'Unable to load following'\)/);
 assert.match(world,/previous\.viewerId===viewerId&&previous\.status==='ready'/);
 assert.match(world,/\?\{\.\.\.previous,error:''\}/);
 assert.match(world,/visibleFollowing\.status==='loading'\|\|visibleFollowing\.status==='idle'/);
});

test('Profile revalidation keeps verified target, tabs and Follow key stable',()=>{
 assert.match(profile,/const verifiedProfile=profileStatus==='ready'\|\|sameVerifiedProfile/);
 assert.match(profile,/const resolvedTargetId=verifiedProfile&&Number\.isSafeInteger/);
 assert.match(profile,/setLoadState\(previous=>previous\.key===requestKey&&previous\.status==='ready'[\s\S]*?\{key:requestKey,status:'loading'\}/);
 assert.match(profile,/disabled=\{!verifiedProfile\}/);
 assert.match(profile,/\(verifiedProfile\|\|!profileId\)/);
 assert.match(profile,/profileStatus==='loading'&&!sameVerifiedProfile/);
 assert.match(profile,/followStatus==='loading'\?<p className="onece-profile-status">Loading following…/);
});

test('Loading copy remains for first reads, errors stay visible and scopes are viewer-bound',()=>{
 assert.match(library,/flagsStatus==='loading'&&active/);
 assert.match(profile,/flagsStatus==='loading'/);
 assert.match(profile,/followStatus==='error'\?null/);
 assert.match(world,/status:'error'/);
 assert.match(profile,/requestKey=String\(user\?\.id\|\|'anonymous'\)\+':'\+targetId/);
 assert.match(follows,/followKey/);
});

test('Cover cache keeps authorized bytes memory-only and viewer-scoped for normal navigation',()=>{
 assert.match(cache,/ttlMs\?\?30\*60\*1000/);
 assert.match(cache,/this\.ttlMs=options\.ttlMs\?\?/);
 assert.match(cache,/clear\(\)\{[\s\S]*?this\.drop/);
 assert.doesNotMatch(cache,/localStorage|indexedDB|caches\.open/);
});

test('This fix does not add audio or persistent-player ownership',()=>{
 for(const source of [flags,follows,world,profile,cache]){
  assert.doesNotMatch(source,/new Audio\(|audioRef|PlayerDockV2|setCurrent\(/);
 }
});
