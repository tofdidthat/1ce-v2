import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const profile=read('public-profile-v2.tsx');
const panel=read('edit-profile-panel-v2.tsx');
const social=read('profile-social-links-v2.tsx');
const workspace=read('workspace-v1.tsx');
const flags=read('project-flags-v2.tsx');
const requests=read('project-requests-v2.ts');
const stylesheet=read('edit-profile-panel-v2.css');

test('own profile pencil opens a modal drawer inside the existing Workspace without a Settings redirect',()=>{
 assert.match(profile,/const \[editorOpen,setEditorOpen\]=useState\(false\)/);
 assert.match(profile,/onClick=\{\(\)=>setEditorOpen\(true\)\}/);
 assert.match(profile,/<EditProfilePanelV2 key=\{String\(user\.id\)\}/);
 assert.match(profile,/editorOpen&&isOwner/);
 assert.match(profile,/onIdentityUpdated=\{onIdentityUpdated\}/);
 assert.match(workspace,/onIdentityUpdated=\{setAccount\}/);
 assert.doesNotMatch(workspace,/onSettings=\{\(\)=>navigate\('\/app\/settings\?edit=profile'\)/);
 assert.match(panel,/role="dialog" aria-modal="true" aria-label="Edit profile"/);
 assert.match(panel,/onKey=\(event:KeyboardEvent\)/);
 assert.match(panel,/event\.key!=='Escape'/);
 assert.match(stylesheet,/\.onece-edit-sheet\{/);
 assert.match(stylesheet,/@media\(max-width:620px\)/);
});

test('photo, username, social row and published grid remain in expected vertical order',()=>{
 const a=panel.indexOf('onece-edit-profile-identity');
 const b=panel.indexOf('<ProfileSocialLinksV2 links={links}');
 const c=panel.indexOf('onece-edit-published-grid');
 assert.ok(a>0&&b>a&&c>b);
 assert.match(panel,/<input id="onece-edit-username"/);
 assert.match(panel,/fileInput\.current\?\.click\(\)/);
 assert.match(panel,/jsonRequest\('\/auth\/me\/avatar'/);
 assert.match(panel,/jsonRequest\('\/auth\/me'/);
 assert.match(panel,/Array\.from\(\{length:4\}/);
 assert.match(panel,/<Plus size=\{23\}\/>/);
});

test('social icon styles map known hosts and use canonical Link2 for other HTTPS links',()=>{
 assert.match(social,/spotify\.com/);
 assert.match(social,/youtube\.com/);
 assert.match(social,/youtu\.be/);
 assert.match(social,/instagram\.com/);
 assert.match(social,/return <Link2 size=\{size\}\/>/);
 assert.match(social,/target="_blank" rel="noopener noreferrer"/);
 assert.match(profile,/<ProfileSocialLinksV2 compact links=/);
 assert.match(panel,/onAdd=\{links\.length<6/);
 assert.doesNotMatch(panel,/navigator\.share\(/);
});

test('Post to profile picker uses canonical Library and shared Publish state, not duplicate routes',()=>{
 assert.match(panel,/fetch\(api\+'\/api\/library\/files\/items'/);
 assert.match(panel,/normalizeLibraryProjectsV2\(data,viewer\)/);
 assert.match(panel,/getProfileFollowsV2|togglePublished\(project\.kind,project\.id\)/);
 assert.match(panel,/published\.has\(projectKey\(project\)\)/);
 assert.match(panel,/className="onece-edit-picker-project"/);
 assert.match(panel,/className="onece-edit-picker-search"/);
 assert.match(panel,/onClick=\{\(\)=>setPicker\(false\)\}[^>]*>Done/);
 assert.match(flags,/togglePublished:\(kind:ProjectKindV2,id:string\)/);
 assert.match(requests,/await projectMutation\('\/api\/public\/publish\/'/);
 assert.doesNotMatch(panel,/\/api\/public\/post-to-profile|\/api\/public\/featured|\/api\/profile\/publish/);
 assert.match(workspace,/<LibraryItemsV2 active=\{view==='library'\}/);
});

test('error and readiness states prevent unauthorized or duplicate publish',()=>{
 assert.match(panel,/flagsStatus!=='ready'\|\|busyKey/);
 assert.match(panel,/disabled=\{flagsStatus!=='ready'\|\|!!busyKey\}/);
 assert.match(panel,/setBusyKey\(key\)/);
 assert.match(panel,/onProfileUpdated\(\)/);
 assert.match(panel,/library\.status==='error'/);
 assert.match(panel,/setRevision\(v=>v\+1\)/);
 assert.match(panel,/notifyV2DataChanged\(\['identity'\],viewer\)/);
});
