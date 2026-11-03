import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workspace=readFileSync(new URL('../src/workspace-v1.tsx',import.meta.url),'utf8');
const router=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
const compactNav=workspace.slice(workspace.indexOf('function CompactWorkspaceNav('),workspace.indexOf('function HeaderV2('));

test('touch opening does not hide and blur the compact navbar trigger',()=>{
 assert.ok(compactNav.length>1000,'CompactWorkspaceNav must be present');
 assert.match(workspace,/\.onece-compact-nav\.is-open > \.onece-nav-trigger \{ opacity: 0; pointer-events: none; \}/);
 assert.doesNotMatch(workspace,/\.onece-compact-nav\.is-open > \.onece-nav-trigger \{[^}]*visibility:\s*hidden/);
 assert.match(compactNav,/onClick=\{\(\) => \{\s*if \(open\) \{[\s\S]*?\} else focusOption\(items\.indexOf\(current\)\)/);
 assert.match(compactNav,/aria-expanded=\{open\}/);
 assert.match(compactNav,/aria-controls=\{listId\}/);
});

test('mobile focus changes cannot immediately dismiss the expanded navbar',()=>{
 assert.match(compactNav,/if \(event\.relatedTarget && !event\.currentTarget\.contains\(event\.relatedTarget\) && !pointerInside\.current\) setOpen\(false\)/);
 assert.match(compactNav,/document\.addEventListener\('pointerdown', outside\)/);
 assert.match(compactNav,/if \(!root\.current\?\.contains\(event\.target\)\) setOpen\(false\)/);
 assert.match(compactNav,/event\.key === 'Escape'/);
 assert.match(compactNav,/if \(event\.pointerType === 'mouse'\)/);
 assert.match(compactNav,/onClick=\{\(\) => select\(item\.id\)\}/);
});

test('compact nav buttons keep the existing app routes and keyboard support',()=>{
 for(const [id,label,path] of [
  ['library','Home','library'],
  ['discover','Discover','discover'],
  ['upload','Upload','upload'],
  ['account','Settings','settings']
 ]){
  assert.match(compactNav,new RegExp("id: '"+id+"', label: '"+label+"'"));
  assert.match(router,new RegExp('path="/app/'+path+'"'));
 }
 assert.match(compactNav,/event\.key === 'ArrowDown'/);
 assert.match(compactNav,/event\.key === 'ArrowUp'/);
 assert.match(compactNav,/options\.current\[next\]\?\.focus\(\)/);
 assert.match(workspace,/library-profile-trigger/);
 assert.match(workspace,/onClick=\{\(\)=>onNavigate\(view==='profile'/);
});
