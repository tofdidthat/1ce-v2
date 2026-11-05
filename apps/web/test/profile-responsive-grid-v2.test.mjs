import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const css=read('public-profile-v2.css');
const home=read('library-items-v2.css');
const profile=read('public-profile-v2.tsx');
const tokens=read('project-grid-tokens-v2.css');
const card=read('project-card-v2.tsx');
const menu=read('project-context-menu-v2.tsx');
const menuCss=read('project-context-menu-v2.css');

test('Catalog and Saves share the wide panel while Following stays a compact list',()=>{
 assert.match(profile,/className=\{"onece-profile-panel"\+\(tab==='following'\?"":" onece-profile-panel-projects"\)\}/);
 assert.match(css,/\.onece-profile-panel-projects\{width:100%\}/);
 assert.match(css,/\.onece-profile-panel\{width:min\(520px,100%\)/);
 assert.match(profile,/className="onece-profile-projects"/);
 assert.doesNotMatch(profile,/is-compact/);
});

test('profile cards match enlarged Home cards and preserve flex-wrap behavior',()=>{
 assert.match(home,/\.onece-v2-library \.beat-pack-grid\{display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;gap:var\(--onece-project-grid-gap\)/);
 assert.match(home,/\.onece-v2-library \.beat-pack-grid>article\{box-sizing:border-box;flex:0 0 var\(--onece-project-card-size\);width:var\(--onece-project-card-size\)/);
 assert.match(css,/\.onece-profile-projects\{display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;gap:var\(--onece-project-grid-gap\)/);
 assert.match(css,/\.onece-profile-project\{box-sizing:border-box;flex:0 0 var\(--onece-project-card-size\);width:var\(--onece-project-card-size\)/);
 assert.match(css,/max-width:var\(--onece-project-grid-max-width\);margin:0 auto/);
 assert.doesNotMatch(css,/\.onece-profile-projects\{display:grid/);
 assert.doesNotMatch(css,/\.onece-profile-projects\.is-compact/);
});

test('mobile cards use the same 600px threshold, 2-across card sizing and gap as Home',()=>{
 assert.match(home,/@media\(max-width:600px\)\{[^\n]*\.beat-pack-grid\{gap:var\(--onece-project-mobile-gap\)\}/);
 assert.match(home,/flex:0 0 var\(--onece-project-mobile-card-size\)/);
 assert.match(css,/@media\(max-width:600px\)\{/);
 assert.match(css,/\.onece-profile-projects\{gap:var\(--onece-project-mobile-gap\)\}/);
 assert.match(css,/\.onece-profile-projects>\.onece-profile-project\{flex:0 0 var\(--onece-project-mobile-card-size\)/);
});

test('square covers, playback overlay and original project card callbacks remain intact',()=>{
 assert.match(css,/\.onece-profile-project-cover\{width:100%;aspect-ratio:1/);
 assert.match(css,/\.onece-profile-project-art \.v2-card-play\.onece-profile-project-play/);
 assert.match(profile,/<ProjectCardV2 key=\{key\}/);
 assert.match(profile,/onPlay=\{onPlayProject\?/);
 assert.match(profile,/onOpen=\{onOpenProject\?/);
});

test('shared grid tokens and menu CSS have one authoritative owner without drift',()=>{
 assert.match(card,/import '\.\/project-grid-tokens-v2.css'/);
 assert.match(menu,/import '\.\/project-context-menu-v2.css'/);
 assert.doesNotMatch(menu,/import '\.\/library-items-v2.css'/);
 for(const [key,value] of [['card-size','216px'],['grid-gap','32px'],['mobile-gap','20px 14px'],['grid-max-width','960px'],['cover-radius','14px'],['title-size','14px']])
  assert.ok(tokens.includes('--onece-project-'+key+':'+value),key);
 assert.match(tokens,/--onece-project-mobile-card-size:min\(216px,calc\(\(100% - 14px\)\/2\)\)/);
 assert.match(menuCss,/\.v2-context-menu\{/);
 assert.doesNotMatch(home,/\.v2-context-menu\{/);
 assert.doesNotMatch(css,/\.onece-profile-context-menu\{/);
});
