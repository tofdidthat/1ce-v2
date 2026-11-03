import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const profile=read('public-profile-v2.tsx');
const workspace=read('workspace-v1.tsx');
const profileCss=read('public-profile-v2.css');
const menu=read('project-context-menu-v2.tsx');

test('profile and other screens use exactly the same HeaderV2 geometry and subdued button styles',()=>{
 assert.match(workspace,/<HeaderV2 view=\{view\} user=\{account\}/);
 assert.match(workspace,/\{view==='profile'\?null:<header className="onece-workspace-header"/);
 assert.match(profile,/<header className="onece-workspace-header onece-profile-navbar"/);
 assert.match(profile,/<div className="onece-workspace-brand">/);
 assert.match(profile,/<div className="onece-workspace-actions onece-profile-nav-actions">/);
 for(const cls of ['onece-profile-nav-back','onece-profile-nav-edit','onece-profile-nav-follow','onece-profile-nav-copy']){
  assert.match(profile,new RegExp('className="library-settings '+cls+'"'),cls);
 }
 assert.match(workspace,/height: calc\(80px \+ env\(safe-area-inset-top\)\)/);
 assert.match(workspace,/max\(64px, env\(safe-area-inset-right\)\)/);
 assert.match(workspace,/max\(64px, env\(safe-area-inset-left\)\)/);
 assert.match(workspace,/height: calc\(76px \+ env\(safe-area-inset-top\)\)/);
 assert.match(workspace,/max\(16px, env\(safe-area-inset-right\)\)/);
 assert.match(workspace,/max\(16px, env\(safe-area-inset-left\)\)/);
 assert.match(workspace,/transform: translateY\(6px\)/);
 assert.match(workspace,/transform: translateY\(4px\)/);
 assert.match(workspace,/background: #ffffff05/);
 assert.match(workspace,/color: #aaa1b6/);
 assert.match(workspace,/width: 44px/);
 assert.match(workspace,/height: 44px/);
 // Don't reintroduce the out-of-alignment 30px inset or white-on-opaque control style.
 assert.doesNotMatch(profileCss,/max\(30px/);
 assert.doesNotMatch(profileCss,/\.onece-profile-navbar\s*\{[^}]*padding/);
 assert.doesNotMatch(profileCss,/background:#242328;color:#f5f3f7/);
 assert.match(profileCss,/\.onece-workspace-header\.onece-profile-navbar \.library-settings\.onece-profile-nav-follow/);
});

test('Back is aligned with right buttons, and Copy link is the exact icon from context menu',()=>{
 assert.match(profile,/<ArrowLeft size=\{22\}\/>/);
 assert.match(profile,/<Pencil size=\{22\}\/>/);
 assert.match(menu,/item\('Copy link',<Link2 size=\{17\}\/>/);
 assert.match(profile,/aria-label="Copy profile link"/);
 assert.match(profile,/<Link2 size=\{22\}\/><\/button>/);
 assert.doesNotMatch(profile,/<Copy size=/);
 assert.match(profile,/className="onece-workspace-actions onece-profile-nav-actions"/);
 assert.match(profile,/className="onece-workspace-brand"/);
 assert.doesNotMatch(profile,/<Share2/);
});

test('Follow/Edit/Back/Copy behaviors remain intact; project player is untouched',()=>{
 assert.match(profile,/onClick=\{onBack\}/);
 assert.match(profile,/onClick=\{\(\)=>setEditorOpen\(true\)\}/);
 assert.match(profile,/onClick=\{\(\)=>void changeFollow\(\)\}/);
 assert.match(profile,/onClick=\{\(\)=>void copyProfileLink\(\)\}/);
 assert.match(profile,/setProfileFollowV2\(resolvedTargetId,followData\.viewerFollows\)/);
 assert.match(profile,/navigator\.clipboard\.writeText\(url\)/);
 assert.match(workspace,/onIdentityUpdated=\{setAccount\}/);
 assert.match(workspace,/onBack=\{\(\)=>\{const index=window\.history\.state\?\.idx/);
 assert.match(workspace,/<LibraryItemsV2 active=\{view==='library'\}/);
 assert.match(workspace,/onPlaybackChange=\{setPlayback\}/);
});
