import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const css=read('public-profile-v2.css');
const home=read('library-items-v2.css');
const profile=read('public-profile-v2.tsx');

test('Catalog and Saves share the wide panel while Following stays a compact list',()=>{
 assert.match(profile,/className=\{"onece-profile-panel"\+\(tab==='following'\?"":" onece-profile-panel-projects"\)\}/);
 assert.match(css,/\.onece-profile-panel-projects\{width:100%\}/);
 assert.match(css,/\.onece-profile-panel\{width:min\(520px,100%\)/);
 assert.match(profile,/className="onece-profile-projects"/);
 assert.doesNotMatch(profile,/is-compact/);
});

test('profile cards have Home exact desktop size and flex-wrap behavior',()=>{
 assert.match(home,/\.onece-v2-library \.beat-pack-grid\{display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;gap:32px/);
 assert.match(home,/\.onece-v2-library \.beat-pack-grid>article\{box-sizing:border-box;flex:0 0 160px;width:160px/);
 assert.match(css,/\.onece-profile-projects\{display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;gap:32px/);
 assert.match(css,/\.onece-profile-project\{box-sizing:border-box;flex:0 0 160px;width:160px/);
 assert.match(css,/max-width:960px;margin:0 auto/);
 assert.doesNotMatch(css,/\.onece-profile-projects\{display:grid/);
 assert.doesNotMatch(css,/\.onece-profile-projects\.is-compact/);
});

test('mobile cards use the same 600px threshold, 2-across card sizing and gap as Home',()=>{
 assert.match(home,/@media\(max-width:600px\)\{[^\n]*\.beat-pack-grid\{gap:20px 14px\}/);
 assert.match(home,/flex:0 0 min\(160px,calc\(\(100% - 14px\)\/2\)\)/);
 assert.match(css,/@media\(max-width:600px\)\{/);
 assert.match(css,/\.onece-profile-projects\{gap:20px 14px\}/);
 assert.match(css,/\.onece-profile-projects>\.onece-profile-project\{flex:0 0 min\(160px,calc\(\(100% - 14px\)\/2\)\)/);
});

test('square covers, playback overlay and original project card callbacks remain intact',()=>{
 assert.match(css,/\.onece-profile-project-cover\{width:100%;aspect-ratio:1/);
 assert.match(css,/\.onece-profile-project-art \.v2-card-play\.onece-profile-project-play/);
 assert.match(profile,/<ProjectCardV2 key=\{key\}/);
 assert.match(profile,/onPlay=\{onPlayProject\?/);
 assert.match(profile,/onOpen=\{onOpenProject\?/);
});
