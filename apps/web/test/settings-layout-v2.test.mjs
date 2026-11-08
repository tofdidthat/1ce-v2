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
 assert.match(workspace,/\{view==='edit-profile'&&showBack&&<button type="button" className="library-settings onece-workspace-back"/);
 assert.match(workspace,/onClick=\{\(\)=>onNavigate\('library'\)\}><img src="\/1ce-logo.png" alt="1CE"\/>/);
 assert.match(workspace,/\.onece-workspace-brand \{ display: flex; align-items: center; gap: 14px/);
 assert.match(profile,/onece-workspace-brand onece-profile-header-brand/);
 assert.match(profile,/onClick=\{onBack\}/);
 assert.doesNotMatch(profile,/onece-workspace-logo-home|1ce-logo\.png/);
 assert.match(profile,/onClick=\{\(\)=>void changeFollow\(\)\}/);
 assert.match(profile,/onClick=\{\(\)=>setEditorOpen\(true\)\}/);
 assert.match(profile,/onClick=\{\(\)=>void copyProfileLink\(\)\}/);
 assert.match(workspace,/<LibraryItemsV2 active=\{view==='library'\}/);
});

test('Settings hides the header profile shortcut but keeps logo and shared navigation',()=>{
 const sharedHeader=workspace.slice(workspace.indexOf("function HeaderV2("),workspace.indexOf("function EmptyLibrary("));
 assert.match(sharedHeader,/\{view!=='account'&&<button type="button" className="library-settings library-profile-trigger"/);
 assert.match(sharedHeader,/onClick=\{\(\)=>onNavigate\('profile'\)\}/);
 assert.match(sharedHeader,/<CompactWorkspaceNav view=\{view\} disabled=\{false\} onNavigate=\{onNavigate\}\/\>/);
 assert.match(sharedHeader,/onClick=\{\(\)=>onNavigate\('library'\)\}><img src="\/1ce-logo.png" alt="1CE"\/>/);
 assert.match(settings,/onClick=\{onViewProfile\}/,'Settings content must retain profile access');
});
test('Home retains the original shared dropdown, not a direct Settings shortcut',()=>{
 assert.match(workspace,/<CompactWorkspaceNav view=\{view\} disabled=\{false\} onNavigate=\{onNavigate\}\/>/);
 assert.doesNotMatch(workspace,/onece-home-settings-trigger/);
 assert.match(workspace,/\{ id: 'library', label: 'Home', icon: <HomeMark \/> \}/);
 assert.match(workspace,/\{ id: 'discover', label: 'World', icon: <GlobeMark \/> \}/);
 assert.match(workspace,/\{ id: 'upload', label: 'Upload', icon: <UploadMark \/> \}/);
 assert.match(workspace,/\{ id: 'account', label: 'Settings', icon: <SettingsMark \/> \}/);
});

test('Back is context-sensitive: Home origin hides the arrow, other origins preserve history navigation',()=>{
 assert.match(workspace,/const previousWorkspacePath=typeof location\.state\?\.oneceFromPath==='string'\?location\.state\.oneceFromPath:null/);
 assert.match(workspace,/const showContextBack=previousWorkspacePath!=='\/app\/library'/);
 assert.match(workspace,/view==='edit-profile'&&showBack&&<button/);
 assert.match(workspace,/<HeaderV2 view=\{view\} user=\{account\} onNavigate=\{onNavigate\} showBack=\{showContextBack\} onBack=\{onWorkspaceBack\}/);
 assert.match(workspace,/if\(previousWorkspacePath&&typeof window\.history\.state\?\.idx==='number'&&window\.history\.state\.idx>0\)navigate\(-1\)/);
 assert.match(workspace,/else onNavigate\('library'\)/);
 assert.match(workspace,/state:\{oneceFromPath:location\.pathname\}/);
 assert.match(profile,/\{showBack&&<button type="button" className="library-settings onece-profile-nav-back"/);
 assert.match(workspace,/showBack profileId=/);
 assert.doesNotMatch(profile,/onece-workspace-logo-home|1ce-logo\.png/);
 assert.match(workspace,/onClick=\{\(\)=>onNavigate\('library'\)\}><img src="\/1ce-logo.png" alt="1CE"\/>/);
});

test('World, Upload and Settings show only the 1CE logo on the header left, regardless of origin',()=>{
 assert.match(workspace,/\{view==='edit-profile'&&showBack&&<button type="button" className="library-settings onece-workspace-back"/);
 assert.doesNotMatch(workspace,/\{view!=='library'&&showBack&&<button/);
 assert.match(workspace,/onClick=\{\(\)=>onNavigate\('library'\)\}><img src="\/1ce-logo.png" alt="1CE"\/>/);
 assert.match(workspace,/view==='profile'\?null:<header className="onece-workspace-header"/);
 assert.match(workspace,/<CompactWorkspaceNav view=\{view\} disabled=\{false\} onNavigate=\{onNavigate\}\/>/);
 assert.match(workspace,/showBack profileId=/);
 assert.match(profile,/\{showBack&&<button type="button" className="library-settings onece-profile-nav-back"/);
});
