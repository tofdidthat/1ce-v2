import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const profile=read('public-profile-v2.tsx');
const css=read('public-profile-v2.css');
const workspace=read('workspace-v1.tsx');

test('mockup composition uses one centered profile column with deliberate vertical rhythm',()=>{
 assert.match(css,/\.onece-profile-top\{[^}]*justify-content:flex-start;[^}]*min-height:274px;padding:10px 0 45px/);
 assert.match(css,/\.onece-profile-name\{[^}]*margin-top:20px/);
 assert.match(css,/\.onece-profile-top \.onece-social-links\.is-compact\{[^}]*margin-top:20px/);
 assert.match(css,/\.onece-profile-tabs\{[^}]*width:min\(520px,100%\);margin:0 auto/);
 assert.match(css,/\.onece-profile-panel\{[^}]*width:min\(520px,100%\);[^}]*padding:46px 0/);
 assert.match(css,/\.onece-profile-project\{[^}]*flex:0 0 172px;width:172px/);
 assert.match(css,/\.onece-profile-projects\{[^}]*justify-content:flex-start;[^}]*gap:32px/);
});

test('mobile keeps centered avatar, fluid tabs, and narrow two-column project cards',()=>{
 assert.match(css,/@media\(max-width:680px\)/);
 assert.match(css,/\.onece-profile-top\{min-height:248px;padding:12px 0 40px/);
 assert.match(css,/@media\(max-width:420px\)\{\.onece-profile-projects\{gap:20px 14px\}/);
 assert.match(css,/flex:0 0 min\(172px,calc\(\(100% - 14px\)\/2\)\)/);
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
