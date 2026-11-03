import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const main=read('main.tsx');
const workspace=read('workspace-v1.tsx');
const profile=read('public-profile-v2.tsx');
const covers=read('project-cover-v2.tsx');
const cache=read('project-cover-cache-v2.ts');

test('all /app routes and /u profiles reuse one route component, no route-level Workspace remount',()=>{
 for(const path of ['/app/library','/app/discover','/app/upload','/app/settings','/app/profile','/app/profile/edit','/u/:id'])
  assert.ok(main.includes(`<Route path="${path}" element={<WorkspaceRoute/>}/>`),path);
 assert.match(main,/function WorkspaceRoute\(\)/);
 assert.match(main,/useLocation\(\)/);
 assert.match(main,/const publicProfile=location\.pathname\.startsWith\('\/u\/'\)/);
 assert.match(main,/return <WorkspaceV2 user=\{session\.viewer\} profileId=\{publicProfile\?id:undefined\}\/>/);
 assert.doesNotMatch(main,/function PublicUserPage\(/);
 assert.doesNotMatch(main,/function ProtectedLibrary\(/);
});

test('private routes still require a checked session, public profiles accept anonymous visitors',()=>{
 assert.match(main,/status:'checking'\|'ready'/);
 assert.match(main,/fetch\(api\+'\/auth\/me',\{credentials:'include',signal:controller\.signal,cache:'no-store'\}\)/);
 assert.match(main,/if\(!publicProfile&&!session\.viewer\)return <Navigate to="\/login" replace\/>/);
 assert.match(main,/return\(\)=>controller\.abort\(\)/);
 assert.match(main,/profileId=\{publicProfile\?id:undefined\}/);
});

test('recent profile views are bounded, target isolated, and revalidate when revisited',()=>{
 assert.match(workspace,/const activeProfileKey=view==='profile'\?\(profileId\?'public:'\+profileId:'own'\):null/);
 assert.match(workspace,/\.slice\(-3\)/);
 assert.match(workspace,/setRecentProfiles\(activeProfileKey\?\[activeProfileKey\]:\[\]\)/);
 assert.match(workspace,/key=\{String\(account\?\.id\|\|'anonymous'\)\+':'\+profileKey\}/);
 assert.match(workspace,/active=\{activeProfileKey===profileKey\}/);
 assert.match(profile,/if\(active&&!previouslyActive\.current\)\{setRefreshRevision/);
 assert.match(profile,/lastVerifiedProfileKey\.current===requestKey/);
 assert.match(profile,/if\(!active\)return null;/);
 assert.match(profile,/controller\.abort\(\)/);
});

test('cover bytes stay in viewer scoped Workspace cache, offscreen cards release leases',()=>{
 assert.match(workspace,/<ProjectCoverCacheProviderV2 viewerId=\{Number\(account\?\.id\)\|\|null\}>/);
 assert.match(workspace,/<LibraryItemsV2 active=\{view==='library'\}/);
 assert.match(covers,/useMemo\(\(\)=>new ProjectCoverCacheV2\(loadAuthorizedCover\),\[viewerId\]\)/);
 assert.match(covers,/useEffect\(\(\)=>\(\)=>cache\.clear\(\),\[cache\]\)/);
 assert.match(covers,/credentials:'include',cache:'no-store'/);
 assert.match(cache,/maxEntries\?\?48/);
 assert.match(cache,/ttlMs\?\?2\*60\*1000/);
 assert.match(covers,/lease\.release\(\)/);
 assert.doesNotMatch(main+workspace+profile,/localStorage\.setItem\(.*(?:cover|profile|project)/);
});
