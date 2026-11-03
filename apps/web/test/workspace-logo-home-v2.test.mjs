import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const workspace=read('workspace-v1.tsx');
const profile=read('public-profile-v2.tsx');

test('1CE workspace logo is an accessible client-side Home action without full-page navigation',()=>{
 assert.match(workspace,/<button type="button" className="onece-workspace-logo-home" aria-label="Go to Home" title="Home" onClick=\{\(\)=>onNavigate\('library'\)\}>/);
 assert.match(workspace,/<img src="\/1ce-logo\.png" alt="1CE"\/>/);
 assert.match(workspace,/next==='library'\?'\/app\/library'/);
 assert.match(workspace,/\.onece-workspace-logo-home:focus-visible/);
 assert.doesNotMatch(workspace,/window\.location\.(?:assign|href|replace)\(['"]\/app\/library/);
});

test('profile Back arrow remains unchanged and player stays mounted',()=>{
 assert.match(profile,/className="library-settings onece-profile-nav-back" aria-label="Go back" title="Back" onClick=\{onBack\}/);
 assert.match(workspace,/<LibraryItemsV2 active=\{view==='library'\}/);
});
