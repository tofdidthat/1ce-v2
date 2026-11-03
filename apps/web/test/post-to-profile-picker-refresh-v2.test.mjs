import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const panel=source('edit-profile-panel-v2.tsx');
const css=source('edit-profile-panel-v2.css');

test('Post to profile prefetches once on editor mount and keeps verified rows on reopen',()=>{
 assert.match(panel,/if\(!api\|\|!Number\.isSafeInteger\(viewer\)\|\|viewer<1\)return/);
 assert.match(panel,/\},\[viewer,revision\]\)/);
 assert.doesNotMatch(panel,/\},\[picker,viewer,revision\]\)/);
 assert.match(panel,/status:previous\.viewerId===viewer&&previous\.status==='ready'\?'ready':'loading'/);
 assert.match(panel,/function openProjectPicker\(\)/);
 assert.match(panel,/if\(library\.status==='ready'&&library\.viewerId===viewer\)setRevision/);
 assert.match(panel,/className="onece-edit-view-all" onClick=\{openProjectPicker\}/);
 assert.match(panel,/className="onece-edit-published-slot"[^\n]*onClick=\{openProjectPicker\}/);
});

test('viewer-specific results survive only benign refresh errors, not loss of session',()=>{
 assert.match(panel,/type LibraryState=\{viewerId:number\|null;/);
 assert.match(panel,/const emptyLibrary:LibraryState=\{viewerId:null/);
 assert.match(panel,/if\(controller\.signal\.aborted\)return/);
 assert.match(panel,/return\(\)=>controller\.abort\(\)/);
 assert.match(panel,/const denied=\[401,403\]\.includes/);
 assert.match(panel,/status:!denied&&previous\.viewerId===viewer&&previous\.status==='ready'\?'ready':'error'/);
 assert.match(panel,/items:!denied&&previous\.viewerId===viewer\?previous\.items:\[\]/);
 assert.match(panel,/library\.viewerId===viewer&&library\.status==='ready'&&shownItems\.map/);
 assert.match(panel,/library\.error&&<div className="onece-edit-picker-state" role="alert">/);
});

test('modal X is transparent, including on hover, without changing its size or accessibility',()=>{
 assert.match(panel,/aria-label="Close project picker"/);
 assert.match(css,/\.onece-edit-picker>header button\{[^}]*width:36px;height:36px;[^}]*background:transparent/);
 assert.match(css,/\.onece-edit-picker>header button:hover:not\(:disabled\)\{background:transparent/);
 assert.match(css,/\.onece-edit-picker>header button:focus-visible\{outline:2px solid/);
 assert.match(panel,/togglePublished\(project\.kind,project\.id\)/);
});
