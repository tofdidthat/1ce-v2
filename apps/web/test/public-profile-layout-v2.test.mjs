import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const profile=read('public-profile-v2.tsx');
const css=read('public-profile-v2.css');
const workspace=read('workspace-v1.tsx');

test('avatar, name and wider tab controls match the vertical reference hierarchy',()=>{
 assert.match(css,/\.onece-profile-top\{[^}]*justify-content:flex-start;[^}]*min-height:330px;padding:58px 0 46px/);
 assert.match(css,/\.onece-profile-avatar\{[^}]*width:120px;height:120px;flex:0 0 120px/);
 assert.match(css,/\.onece-profile-name\{[^}]*margin-top:20px/);
 assert.match(css,/\.onece-profile-top \.onece-social-links\.is-compact\{[^}]*margin-top:20px/);
 assert.match(css,/\.onece-profile-tabs\{[^}]*width:min\(560px,100%\);margin:0 auto/);
 assert.match(css,/\.onece-profile-tabs button\{[^}]*min-height:56px/);
 assert.match(css,/\.onece-profile-tabs button svg\{width:20px;height:20px/);
 assert.match(css,/\.onece-profile-panel\{width:min\(520px,100%\);[^}]*padding:38px 0/);
 assert.match(css,/\.onece-profile-project\{[^}]*width:160px;min-width:0/);
});

test('mobile keeps centered avatar and tabs with the Home two-card wrapping',()=>{
 assert.match(css,/@media\(max-width:680px\)/);
 assert.match(css,/\.onece-profile-top\{min-height:280px;padding:32px 0 34px/);
 assert.match(css,/@media\(max-width:600px\)\{/);
 assert.match(css,/\.onece-profile-projects\{gap:20px 14px\}/);
 assert.match(css,/\.onece-profile-projects>\.onece-profile-project\{flex:0 0 min\(160px,calc\(\(100% - 14px\)\/2\)\)/);
 assert.doesNotMatch(css,/\.onece-profile-projects\{display:grid/);
});

test('Catalog icon and shared workspace/header remain unchanged',()=>{
 assert.match(profile,/function CatalogLibraryIcon\(\{size=17\}/);
 assert.match(profile,/<path d="M4 4v16M9 4v16M14 4l4 16"\/>/);
 assert.match(profile,/\{id:'catalog',label:'Catalog',icon:<CatalogLibraryIcon\/>\}/);
 assert.match(profile,/<h1>\{handle\?handle\.replace\(\/\^@\/,'\'\):name\}<\/h1>/);
 assert.doesNotMatch(profile,/onece-profile-display-name/);
 assert.match(workspace,/<HeaderV2 view=\{view\} user=\{account\}/);
 assert.match(workspace,/<LibraryItemsV2 active=\{view==='library'\}/);
});
