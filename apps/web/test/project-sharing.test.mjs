import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const library=file('library-items-v2.tsx');
const profile=file('public-profile-v2.tsx');
const sharedPage=file('main.tsx');
const menu=file('project-context-menu-v2.tsx');
const card=file('project-card-v2.tsx');
const cover=file('project-cover-v2.tsx');
const requests=file('project-requests-v2.ts');

test('Library and Profile use the same card, context menu and mutation dialog',()=>{
 for(const view of [library,profile]){
  assert.match(view,/import ProjectCardV2 from '\.\/project-card-v2'/);
  assert.match(view,/import ProjectContextMenuV2 from '\.\/project-context-menu-v2'/);
  assert.match(view,/import ProjectActionDialogV2/);
  assert.match(view,/<ProjectCardV2/);
  assert.match(view,/<ProjectContextMenuV2/);
  assert.doesNotMatch(view,/function (?:Cover|ProjectCover)\(/);
 }
 assert.match(card,/import ProjectCoverV2 from '\.\/project-cover-v2'/);
 assert.match(card,/variant:'library'\|'profile'/);
 assert.match(menu,/onAction\('rename'\)/);
 assert.match(menu,/onAction\('delete'\)/);
});

test('Add to places the folder icon before the label and the chevron after it',()=>{
 assert.match(menu,/\{icon\}<span>\{label\}<\/span>\{trailingIcon\}/);
 assert.match(menu,/item\('Add to\.\.\.',<FolderPlus size=\{17\}\/>.*<ChevronRight className="v2-context-chevron" size=\{15\}\/>\)/);
 assert.doesNotMatch(menu,/<><FolderPlus size=\{17\}\/><ChevronRight/);
});

test('single authorized cover path and no duplicated view-specific fetch fallback',()=>{
 assert.match(cover,/\/api\/public\/cover\//);
 assert.match(cover,/credentials:'include',signal:controller\.signal/);
 assert.match(cover,/controller\.abort\(\)/);
 assert.match(cover,/URL\.revokeObjectURL/);
 assert.doesNotMatch(library,/\/api\/library\/files\/cover\//);
 assert.doesNotMatch(profile,/\/api\/public\/cover\//);
 assert.doesNotMatch(profile,/\/api\/library\/files\/cover\//);
});

test('save publish and share mutations share their HTTP implementation',()=>{
 for(const view of [library,profile]){
  assert.match(view,/setProjectPublishedV2/);
  assert.match(view,/setProjectSavedV2/);
  assert.match(view,/createProjectShareLinkV2/);
  assert.doesNotMatch(view,/\/api\/public\/(?:save|publish|share)\//);
 }
 assert.match(sharedPage,/setProjectSavedV2/);
 assert.doesNotMatch(sharedPage,/\/api\/public\/save\//);
 for(const route of ['publish','save','share'])assert.match(requests,new RegExp('/api/public/'+route+'/'));
 assert.match(requests,/credentials:'include'/);
});
