import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../src/public-profile-v2.css',import.meta.url),'utf8');
const profile=readFileSync(new URL('../src/public-profile-v2.tsx',import.meta.url),'utf8');

test('Catalog and Saves use the wide panel while Following retains the compact list',()=>{
 assert.match(profile,/className=\{"onece-profile-panel"\+\(tab==='following'\?"":" onece-profile-panel-projects"\)\}/);
 assert.match(css,/\.onece-profile-panel-projects\{width:100%\}/);
 assert.match(css,/\.onece-profile-panel\{width:min\(520px,100%\)/);
 assert.match(profile,/className=\{"onece-profile-projects"\+\(\(tab===\x27catalog\x27\?visibleProjects\.catalog:visibleProjects\.saves\)\.length<=5\?" is-compact":""\)\}/);
});

test('responsive project grid displays six desktop, four medium and three mobile columns',()=>{
 assert.match(css,/\.onece-profile-projects\{display:grid;grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(max-width:900px\) and \(min-width:681px\)\{\.onece-profile-projects\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}\}/);
 assert.match(css,/@media\(max-width:680px\)\{\.onece-profile-projects\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(css,/\.onece-profile-project\{box-sizing:border-box;width:100%;min-width:0;position:relative\}/);
 assert.doesNotMatch(css,/\.onece-profile-projects\{[^}]*display:flex/);
});

test('square cover, playback overlay and card labels remain unchanged',()=>{
 assert.match(css,/\.onece-profile-project-cover\{width:100%;aspect-ratio:1/);
 assert.match(css,/\.onece-profile-project-art \.v2-card-play\.onece-profile-project-play/);
 assert.match(profile,/<ProjectCardV2 key=\{key\}/);
});


test('up to five profile cards stay at 172px and center; six or more use fluid desktop grid',()=>{
 assert.match(profile,/length<=5\?" is-compact":""/);
 assert.match(css,/\.onece-profile-projects\.is-compact\{display:flex;flex-wrap:wrap;justify-content:center;gap:24px 12px\}/);
 assert.match(css,/\.onece-profile-projects\.is-compact>\.onece-profile-project\{flex:0 0 172px;width:172px;max-width:100%\}/);
 assert.match(css,/\.onece-profile-projects\{display:grid;grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(max-width:680px\)\{[^\n]*?\.onece-profile-projects\.is-compact>\.onece-profile-project\{flex-basis:calc\(\(100% - 24px\)\/3\)/);
 assert.match(css,/@media\(max-width:420px\)\{[^\n]*?\.onece-profile-projects\.is-compact>\.onece-profile-project\{flex-basis:calc\(\(100% - 18px\)\/3\)/);
});
