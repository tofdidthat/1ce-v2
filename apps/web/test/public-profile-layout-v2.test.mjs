import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const profile=read('public-profile-v2.tsx');
const css=read('public-profile-v2.css');
const workspace=read('workspace-v1.tsx');

test('profile identity and tabs remain centered while the project grid uses wider layout',()=>{
 assert.match(css,/\.onece-profile-top\{[^}]*justify-content:flex-start;[^}]*min-height:274px;padding:10px 0 45px/);
 assert.match(css,/\.onece-profile-name\{[^}]*margin-top:20px/);
 assert.match(css,/\.onece-profile-top \.onece-social-links\.is-compact\{[^}]*margin-top:20px/);
 assert.match(css,/\.onece-profile-tabs\{[^}]*width:min\(520px,100%\);margin:0 auto/);
 assert.match(css,/\.onece-profile-panel\{[^}]*width:min\(520px,100%\);[^}]*padding:46px 0/);
 assert.match(css,/\.onece-profile-project\{[^}]*width:100%;min-width:0/);
 assert.match(css,/\.onece-profile-projects\{display:grid;grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
});

test('mobile keeps centered avatar, fluid tabs, and three-column project cards',()=>{
 assert.match(css,/@media\(max-width:680px\)/);
 assert.match(css,/\.onece-profile-top\{min-height:248px;padding:12px 0 40px/);
 assert.match(css,/@media\(max-width:680px\)\{\.onece-profile-projects\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.doesNotMatch(css,/flex:0 0 min\(172px/);
});

test('Catalog Library icon and shared workspace/header remain unchanged',()=>{
 assert.match(profile,/function CatalogLibraryIcon\(\{size=17\}/);
 assert.match(profile,/<path d="M4 4v16M9 4v16M14 4l4 16"\/>/);
 assert.match(profile,/\{id:'catalog',label:'Catalog',icon:<CatalogLibraryIcon\/>\}/);
 assert.match(profile,/<h1>\{handle\?handle\.replace\(\/\^@\/,'\'\):name\}<\/h1>/);
 assert.doesNotMatch(profile,/onece-profile-display-name/);
 assert.match(workspace,/<HeaderV2 view=\{view\} user=\{account\}/);
 assert.match(workspace,/<LibraryItemsV2 active=\{view==='library'\}/);
});
