import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=n=>readFileSync(new URL('../src/'+n,import.meta.url),'utf8');
const settings=read('account-settings-v2.tsx');
const css=read('account-settings-v2.css');
const workspace=read('workspace-v1.tsx');
const profile=read('public-profile-v2.tsx');

test('Settings keeps original account operations within the wider reference-based two-column composition',()=>{
 assert.match(css,/grid-template-columns:minmax\(0,230px\) minmax\(0,308px\)/);
 assert.match(css,/gap:58px/);
 assert.match(css,/border-radius:20px/);
 assert.match(css,/@media\(max-width:700px\)/);
 assert.match(settings,/className="onece-account-card onece-account-user-card"/);
 assert.match(settings,/className="onece-account-card onece-account-profile-card"/);
 assert.match(settings,/onece-account-group-heading/);
 assert.match(settings,/onClick=\{onViewProfile\}/);
 assert.match(settings,/onClick=\{begin\}/);
 assert.match(settings,/trashOpen\?<TrashSettingsV2/);
 assert.match(settings,/href="\/terms"/);
 assert.match(settings,/href="\/privacy"/);
 assert.match(settings,/onClick=\{\(\)=>void logout\(\)\}/);
 assert.doesNotMatch(settings,/Subscriptions|Referrals|Try membership|Redeem code|fake plan/i);
});
test('Workspace header provides consistent brand geometry and back buttons across pages, including Profile',()=>{
 assert.match(workspace,/\{view!=='library'&&<button type="button" className="library-settings onece-workspace-back"/);
 assert.match(workspace,/onClick=\{\(\)=>onNavigate\('library'\)\}><img src="\/1ce-logo.png" alt="1CE"\/>/);
 assert.match(workspace,/\.onece-workspace-brand \{ display: flex; align-items: center; gap: 14px/);
 assert.match(profile,/onece-workspace-brand onece-profile-header-brand/);
 assert.match(profile,/onClick=\{onBack\}/);
 assert.match(profile,/onClick=\{onGoHome\}><img src="\/1ce-logo.png" alt="1CE"\/>/);
 assert.match(profile,/onClick=\{\(\)=>void changeFollow\(\)\}/);
 assert.match(profile,/onClick=\{\(\)=>setEditorOpen\(true\)\}/);
 assert.match(profile,/onClick=\{\(\)=>void copyProfileLink\(\)\}/);
 assert.match(workspace,/<LibraryItemsV2 active=\{view==='library'\}/);
});
