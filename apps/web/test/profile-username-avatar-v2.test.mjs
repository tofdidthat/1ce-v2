import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const panel=read('edit-profile-panel-v2.tsx');
const css=read('edit-profile-panel-v2.css');
const workspace=read('workspace-v1.tsx');

test('username sits directly under avatar as plain text, no label and no full-width field',()=>{
 assert.match(panel,/className="onece-edit-username-row"/);
 assert.match(panel,/className="onece-edit-username-display"/);
 assert.match(panel,/\{savedUsername\|\|'Set username'\}/);
 assert.doesNotMatch(panel,/<label htmlFor="onece-edit-username">Username<\/label>/);
 assert.match(css,/\.onece-edit-username-row\{[^}]*justify-content:center/);
 assert.match(css,/\.onece-edit-username-display,\.onece-edit-username-row input\{[^}]*border:0;[^}]*background:transparent;[^}]*box-shadow:none;outline:none/);
 assert.match(css,/\.onece-edit-username-row input:focus,[^\{]*\{outline:none;border:0;box-shadow:none;background:transparent/);
 assert.match(css,/transition:none;appearance:none/);
});

test('inline username editing has X cancel and check save without new route or duplicate mutations',()=>{
 assert.match(panel,/onClick=\{cancelUsernameEdit\}/);
 assert.match(panel,/aria-label="Cancel username edit"/);
 assert.match(panel,/aria-label="Save username"/);
 assert.match(panel,/void saveUsernameEdit\(\)/);
 assert.match(panel,/if\(normalized===savedUsername\)/);
 assert.match(panel,/body:JSON\.stringify\(\{username:normalized\}\)/);
 assert.match(panel,/setSavedUsername\(normalized\)/);
 assert.match(panel,/setUsername\(savedUsername\)/);
 assert.match(panel,/onIdentityUpdated\(result\.user\)/);
 assert.match(panel,/onProfileUpdated\(\)/);
 assert.match(panel,/else if\(editingUsername\)cancelUsernameEdit\(\)/);
 assert.match(panel,/if\(saving\|\|usernameSaving\|\|editingUsername\|\|busyKey\|\|linkEditor\)return/);
 assert.match(panel,/disabled=\{saving\|\|usernameSaving\|\|editingUsername\|\|!!linkEditor\}/);
 assert.doesNotMatch(panel,/\/auth\/username|\/api\/profile\/username/);
 assert.match(workspace,/onIdentityUpdated=\{updated=>\{/);
});

test('avatar image fills the entire circular button without CSS grid shrink',()=>{
 assert.match(css,/\.onece-edit-avatar\{[^}]*width:96px;height:96px;flex:0 0 96px;border-radius:50%/);
 assert.match(css,/\.onece-edit-avatar\{[^}]*display:flex;align-items:center;justify-content:center/);
 assert.doesNotMatch(css,/\.onece-edit-avatar\{[^}]*display:grid/);
 assert.match(css,/\.onece-edit-avatar img\{position:absolute;inset:0;display:block;width:100%;height:100%;[^}]*object-fit:cover;object-position:center;border-radius:50%/);
 assert.match(panel,/<Camera className="onece-edit-camera" size=\{18\}\/>/);
 assert.match(panel,/onClick=\{\(\)=>fileInput\.current\?\.click\(\)\}/);
 assert.match(panel,/jsonRequest\('\/auth\/me\/avatar'/);
});
