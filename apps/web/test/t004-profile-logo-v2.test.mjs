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
 assert.match(profile,/\{showBack&&<button type="button" className="library-settings onece-profile-nav-back" aria-label="Go back" title="Back" onClick=\{onBack\}>/);
 assert.match(profile,/<ChevronLeft size=\{20\}\/>/);
});

test('Shared workspace header still exposes the logo Home action outside Profile',()=>{
 const sharedHeader=workspace.slice(workspace.indexOf('function HeaderV2('),workspace.indexOf('function EmptyLibrary('));
 assert.match(sharedHeader,/<button type="button" className="onece-workspace-logo-home" aria-label="Go to Home" title="Home" onClick=\{\(\)=>onNavigate\('library'\)\}><img src="\/1ce-logo\.png" alt="1CE"\/><\/button>/);
 assert.match(workspace,/\{view==='profile'\?null:<header className="onece-workspace-header"/);
});

test('Profile caller wiring no longer passes the removed onGoHome prop',()=>{
 assert.doesNotMatch(workspace,/onGoHome/);
 assert.match(workspace,/onOpenProfile=\{identifier=>navigate\('\/u\/'\+encodeURIComponent\(identifier\),\{state:\{oneceFromPath:location\.pathname\}\}\)\}\/>\)\}/);
});
