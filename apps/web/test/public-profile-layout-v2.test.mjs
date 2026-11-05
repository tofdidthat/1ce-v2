import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const profile=read('public-profile-v2.tsx');
const css=read('public-profile-v2.css');
const workspace=read('workspace-v1.tsx');

test('avatar moves down while Catalog/Saves/Following move up toward the reference',()=>{
 assert.match(css,/\.onece-profile-top\{[^}]*justify-content:flex-start;[^}]*min-height:294px;padding:68px 0 5px/);
 assert.match(css,/\.onece-profile-avatar\{[^}]*width:120px;height:120px;flex:0 0 120px/);
 assert.match(css,/\.onece-profile-name\{[^}]*margin-top:20px/);
 assert.match(css,/\.onece-profile-top \.onece-social-links\.is-compact\{[^}]*margin-top:20px/);
 assert.match(css,/\.onece-profile-tabs\{[^}]*width:min\(620px,100%\);margin:-20px auto 0/);
 assert.match(css,/\.onece-profile-tabs button\{[^}]*min-height:56px/);
 assert.match(css,/\.onece-profile-tabs button svg\{width:24px;height:24px/);
 assert.match(css,/\.onece-profile-panel\{width:min\(520px,100%\);[^}]*padding:70px 0 38px/);
 assert.match(css,/\.onece-profile-project\{[^}]*width:216px;min-width:0/);
});

test('mobile keeps centered avatar and tabs with the Home two-card wrapping',()=>{
 assert.match(css,/@media\(max-width:680px\)/);
 assert.match(css,/\.onece-profile-tabs\{margin:0 auto\}/,'Mobile tabs must not use the desktop negative margin');
 assert.match(css,/\.onece-profile-top\{min-height:280px;padding:32px 0 34px/);
 assert.match(css,/@media\(max-width:600px\)\{/);
 assert.match(css,/\.onece-profile-projects\{gap:20px 14px\}/);
 assert.match(css,/\.onece-profile-projects>\.onece-profile-project\{flex:0 0 min\(216px,calc\(\(100% - 14px\)\/2\)\)/);
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
