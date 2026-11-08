import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const profile=read('public-profile-v2.tsx');
const workspace=read('workspace-v1.tsx');

test('Profile page no longer renders the top-left 1CE logo',()=>{
 assert.doesNotMatch(profile,/onece-workspace-logo-home/);
 assert.doesNotMatch(profile,/1ce-logo\.png/);
 assert.doesNotMatch(profile,/aria-label="Go to Home"/);
 assert.doesNotMatch(profile,/onGoHome/);
});

test('Profile keeps the Back control and its navbar brand container',()=>{
 assert.match(profile,/<div className="onece-workspace-brand onece-profile-header-brand">/);
 assert.match(profile,/<button type="button" className="library-settings onece-profile-nav-back" aria-label="Go back" title="Back" onClick=\{onBack\}>/);
 assert.match(profile,/<ChevronLeft size=\{20\}\/>/);
});

test('Shared workspace header still exposes the logo Home action outside Profile',()=>{
 const sharedHeader=workspace.slice(workspace.indexOf('function HeaderV2('),workspace.indexOf('function EmptyLibrary('));
 assert.match(sharedHeader,/<button type="button" className="onece-workspace-logo-home" aria-label="Go to Home" title="Home" onClick=\{\(\)=>onNavigate\('library'\)\}><img src="\/1ce-logo\.png" alt="1CE"\/><\/button>/);
 assert.match(workspace,/\{view==='profile'\?null:<header className="onece-workspace-header"/);
});

test('Profile always renders its Back arrow, even when opened from Home',()=>{
 // showContextBack is false for Home-origin views. The Profile must not depend
 // on it: with no logo there would be no in-page way back.
 assert.match(workspace,/const showContextBack=previousWorkspacePath!=='\/app\/library'/);
 assert.doesNotMatch(workspace,/user=\{account\} showBack profileId=/);
 assert.doesNotMatch(profile,/showBack/);
});

test('Profile Back returns to the originating page, falling back to Home',()=>{
 assert.ok(workspace.includes("onBack={()=>{const index=window.history.state?.idx;if(typeof index==='number'&&index>0)navigate(-1);else navigate(account?.id?'/app/library':'/');}}"));
});

test('Profile caller wiring no longer passes the removed onGoHome prop',()=>{
 assert.doesNotMatch(workspace,/onGoHome/);
 assert.match(workspace,/onOpenProfile=\{identifier=>navigate\('\/u\/'\+encodeURIComponent\(identifier\),\{state:\{oneceFromPath:location\.pathname\}\}\)\}\/>\)\}/);
});
