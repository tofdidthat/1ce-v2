import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const profile=src('public-profile-v2.tsx');
const workspace=src('workspace-v1.tsx');
const transport=src('profile-follows-v2.ts');
const refresh=src('data-refresh-v2.ts');

test('profile navbar replaces normal header, preserves back and own pencil to real Settings',()=>{
 assert.match(workspace,/<HeaderV2 view=\{view\} user=\{account\}/);
 assert.match(workspace,/\{view==='profile'\?null:<header className="onece-workspace-header"/);
 assert.match(workspace,/onBack=\{\(\)=>\{const index=window\.history\.state\?\.idx/);
 assert.match(workspace,/navigate\(-1\)/);
 assert.match(workspace,/navigate\(account\?\.id\?'\/app\/library':'\/'\)/);
 assert.match(workspace,/onIdentityUpdated=\{updated=>\{/);
 assert.match(workspace,/setAccount\(updated\)/);
 assert.match(profile,/onClick=\{\(\)=>setEditorOpen\(true\)\}/);
 assert.match(profile,/<header className="onece-workspace-header onece-profile-navbar"/);
 assert.match(profile,/<ChevronLeft size=\{20\}\/>/);
 assert.match(profile,/<Pencil size=\{22\}\/>/);
 assert.match(profile,/isOwner\?/);
 assert.match(profile,/String\(visibleProfileUser\?\.id\)/); // verified target identity, not URL guess
});
test('other profiles expose real Follow/Unfollow; no follow mutation available for own or anonymous',()=>{
 assert.match(profile,/changeFollow=async/);
 assert.match(profile,/if\(!user\?\.id\)\{onLogin\(\);return;\}/);
 assert.match(profile,/!resolvedTargetId\|\|isOwner\|\|followStatus!=='ready'/);
 assert.match(profile,/setProfileFollowV2\(resolvedTargetId,followData\.viewerFollows\)/);
 assert.match(profile,/followData\?\.viewerFollows\?<UserRoundCheck size=\{22\}\/>:<UserRoundPlus size=\{22\}\/>/);
 assert.match(profile,/aria-label=\{followData\?\.viewerFollows\?'Unfollow profile':'Follow profile'\}/);
 assert.doesNotMatch(profile,/followData\?\.viewerFollows\?'Following':'Follow'/);
 assert.match(profile,/aria-pressed=\{Boolean\(followData\?\.viewerFollows\)\}/);
 assert.match(transport,/method:alreadyFollowing\?'DELETE':'POST'/);
 assert.match(transport,/credentials:'include'/);
 assert.match(transport,/\/api\/public\/follows\//);
});
test('copy link is canonical and share icon next to name is gone',()=>{
 assert.match(profile,/window\.location\.origin\+'\/u\/'\+encodeURIComponent\(identifier\)/);
 assert.match(profile,/navigator\.clipboard\.writeText\(url\)/);
 assert.match(profile,/aria-label="Copy profile link"/);
 assert.doesNotMatch(profile,/aria-label="Share profile"/);
 assert.doesNotMatch(profile,/<Share2/);
});
test('Following tab lists actual profiles and navigates by public handle',()=>{
 assert.match(profile,/followData\?\.followingUsers\.length/);
 assert.match(profile,/followData\.followingUsers\.map\(person/);
 assert.match(profile,/onOpenProfile\(person\.username\|\|String\(person\.id\)\)/);
 assert.match(workspace,/onOpenProfile=\{identifier=>navigate\('\/u\/'\+encodeURIComponent\(identifier\),\{state:\{oneceFromPath:location\.pathname\}\}\)\}/);
 assert.match(workspace,/onGoHome=\{\(\)=>onNavigate\('library'\)\}/);
 assert.match(profile,/getProfileFollowsV2\(resolvedTargetId,controller\.signal\)/);
 assert.match(profile,/controller\.abort\(\)/);
 assert.match(refresh,/\|'follows'/);
 assert.match(profile,/notifyV2DataChanged\(\['follows'\]/);
});
test('profile read errors remain visible; management-only error hidden for anonymous',()=>{
 assert.match(profile,/error&&<p role="alert"/);
 assert.match(profile,/Boolean\(user\?\.id\)&&flagsStatus==='error'/);
 assert.match(profile,/flagsStatus==='ready'\?/);
});
