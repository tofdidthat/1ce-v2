import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workspace=readFileSync(new URL('../src/workspace-v1.tsx',import.meta.url),'utf8');
const nav=workspace.slice(workspace.indexOf('function CompactWorkspaceNav('),workspace.indexOf('function HeaderV2('));
const styles=workspace.slice(workspace.indexOf('.onece-compact-nav {'),workspace.indexOf('.onece-workspace-shell .library-page'));

test('mobile tap opens the compact navbar without forcing focus into the hidden reveal',()=>{
 assert.match(nav,/onClick=\{event => \{/);
 assert.match(nav,/event\.detail === 0[\s\S]*?focusOption\(items\.indexOf\(current\)\)/);
 assert.match(nav,/else \{[\s\S]*?setOpen\(true\)[\s\S]*?\}\s*\}/);
 assert.match(nav,/aria-expanded=\{open\}/);
 assert.match(nav,/aria-controls=\{listId\}/);
 assert.match(nav,/onClick=\{\(\) => select\(item\.id\)\}/);
});

test('expanded trigger stays focusable in DOM instead of blurring when hidden on mobile',()=>{
 assert.match(styles,/\.onece-compact-nav\.is-open > \.onece-nav-trigger \{ opacity: 0; pointer-events: none; \}/);
 assert.doesNotMatch(styles,/\.onece-compact-nav\.is-open > \.onece-nav-trigger \{[^}]*visibility:\s*hidden/);
 assert.match(styles,/\.onece-nav-reveal \{[^}]*z-index: 1;[^}]*pointer-events: none;/);
 assert.match(styles,/\.onece-compact-nav\.is-open \.onece-nav-reveal \{[^}]*visibility: visible; pointer-events: auto;/);
});

test('desktop hover, keyboard arrows, outside click and Escape remain supported',()=>{
 assert.match(nav,/event\.pointerType === 'mouse'/);
 assert.match(nav,/document\.addEventListener\('pointerdown', outside\)/);
 assert.match(nav,/document\.addEventListener\('keydown', escape\)/);
 assert.match(nav,/event\.key === 'Escape'/);
 assert.match(nav,/\['ArrowDown', 'ArrowUp', 'Home', 'End'\]/);
 assert.match(nav,/if \(!event\.currentTarget\.contains\(event\.relatedTarget\) && !pointerInside\.current\) setOpen\(false\)/);
 for(const item of ['library','discover','upload','account'])assert.match(nav,new RegExp("id: '"+item+"'"));
});
