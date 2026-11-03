import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=n=>readFileSync(new URL('../src/'+n,import.meta.url),'utf8');
const panel=src('edit-profile-panel-v2.tsx');
const css=src('edit-profile-panel-v2.css');
const menu=src('project-context-menu-v2.tsx');

test('inline URL editor preserves one-line URL-only input and exact cancel, save, delete order',()=>{
 const start=panel.indexOf('className="onece-edit-link-row"');
 const end=panel.indexOf('className="onece-edit-help"',start);
 const row=panel.slice(start,end);
 assert.ok(start>=0&&end>start);
 const x=row.indexOf('aria-label="Cancel link editing"');
 const save=row.indexOf('aria-label="Save link"');
 const del=row.indexOf('aria-label="Remove link"');
 assert.ok(x>=0&&save>x&&del>save);
 assert.match(row,/className="onece-edit-link-field"/);
 assert.match(row,/type="url" inputMode="url"/);
 assert.match(row,/onClick=\{confirmLink\}/);
 assert.match(row,/linkEditor.index>=0&&<button/);
 assert.match(row,/className="onece-edit-link-delete"/);
 assert.match(row,/<Trash2 size=\{17\}\/>/);
 assert.match(menu,/<Trash2 size=\{17\}\/>/);
 assert.doesNotMatch(row,/link title|Link title|aria-label="Link title"/);
});

test('URL focus has no purple border, actions transparent and aligned; delete red',()=>{
 assert.match(css,/\.onece-edit-link-field input:focus,\.onece-edit-link-field input:focus-visible\{outline:none;box-shadow:none;border:0\}/);
 assert.match(css,/\.onece-edit-link-field:focus-within\{outline:none;box-shadow:none;border-color:#353138\}/);
 assert.match(css,/\.onece-edit-link-row\{[^}]*align-items:center;[^}]*width:100%;min-width:0/);
 assert.match(css,/\.onece-edit-link-row>button\{[^}]*display:grid;place-items:center;[^}]*height:40px;[^}]*background:transparent/);
 assert.match(css,/\.onece-edit-link-row>button\.onece-edit-link-delete\{color:#ed4652\}/);
 assert.match(css,/\.onece-edit-link-row>button:focus-visible\{outline:1px/);
});

test('existing link validation and identity persistence are unchanged',()=>{
 assert.match(panel,/function confirmLink\(\)/);
 assert.match(panel,/parsed.protocol!=='https:'/);
 assert.match(panel,/Duplicate link/);
 assert.match(panel,/JSON.stringify\(\{links\}\)/);
 assert.match(panel,/jsonRequest\('\/auth\/me'/);
});
