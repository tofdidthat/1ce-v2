import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
const workspace=read('workspace-v1.tsx');
const world=read('world-v2.tsx');
const worldCss=read('world-v2.css');
const profile=read('public-profile-v2.tsx');
const items=read('library-items-v2.tsx');
const upload=read('library-upload-v1.tsx');
const panel=read('edit-profile-panel-v2.tsx');
const main=read('main.tsx');
const actions=read('project-action-dialog-v2.tsx');

test('workspace Home navigation is house, World navigation retains exactly the existing globe SVG',()=>{
 assert.match(workspace,/import \{House\} from 'lucide-react'/);
 assert.match(workspace,/function HomeMark\(\)[\s\S]*?<House className="w-5 h-5" size=\{22\}/);
 assert.match(workspace,/\{ id: 'library', label: 'Home', icon: <HomeMark \/> \}/);
 assert.match(workspace,/\{ id: 'discover', label: 'World', icon: <GlobeMark \/> \}/);
 assert.match(workspace,/<circle cx="12" cy="12" r="9" \/>/);
 assert.match(workspace,/<ellipse cx="12" cy="12" rx="4" ry="9" \/>/);
 assert.match(workspace,/<path d="M3 12h18" \/>/);
 // The user requested a house only for Home, not the Catalog tab.
 assert.match(profile,/function CatalogLibraryIcon\(\{size=17\}/);
 assert.match(profile,/<path d="M4 4v16M9 4v16M14 4l4 16"\/>/);
});
test('names are user-facing; old route keys and persistent player stay unchanged',()=>{
 assert.match(workspace,/location\.pathname==='\/app\/library'\?'library'/);
 assert.match(workspace,/location\.pathname\.endsWith\('\/discover'\)\?'discover'/);
 assert.match(workspace,/next==='library'\?'\/app\/library'/);
 assert.match(workspace,/document\.title=\(\{library:'Home',discover:'World'/);
 assert.match(workspace,/view==='discover'\?<WorldV2/);
 assert.match(workspace,/<LibraryItemsV2 active=\{view==='library'\}/);
 assert.match(main,/<Route path="\/app\/library" element=\{<WorkspaceRoute\/>\}/);
 assert.match(main,/<Route path="\/app\/discover" element=\{<WorkspaceRoute\/>\}/);
});
test('all user-facing Library text becomes Home while API paths and selectors remain intact',()=>{
 assert.match(items,/Loading your Home…/);
 assert.match(items,/Your Home is empty/);
 assert.match(items,/detailOrigin==='profile'\?'Back to Profile':'Back to Home'/);
 assert.match(upload,/Save to Home/);
 assert.match(panel,/aria-label="Search your Home"/);
 assert.match(panel,/Loading Home…/);
 assert.match(main,/Save to Home/);
 assert.match(actions,/from Home, Catalog/);
 assert.match(profile,/Private projects in Home are never displayed automatically/);
 for(const file of [workspace,items,upload,panel,main,actions,profile]){
  for(const phrase of ['Save to Library','Loading your Library','Your Library is Empty','Search your library','Discover is not yet available','label: \'Discover\''])
   assert.ok(!file.includes(phrase),phrase+' must not remain visible');
 }
 assert.match(items,/api\+'\/api\/library\/files\/items'/);
});
test('World has accessible independent For you and Following tabs and responsive 1CE styling',()=>{
 assert.match(world,/type WorldTab='for-you'\|'following'/);
 assert.match(world,/\{id:'for-you',label:'For you'\},\{id:'following',label:'Following'\}/);
 assert.match(world,/role="tablist" aria-label="World sections"/);
 assert.match(world,/role="tab" id=\{'onece-world-tab-'/);
 assert.match(world,/aria-selected=\{tab===item.id\}/);
 assert.match(world,/tabIndex=\{tab===item.id\?0:-1\}/);
 assert.match(world,/role="tabpanel" aria-labelledby=\{'onece-world-tab-'\+tab\}/);
 assert.match(world,/event\.key==='ArrowRight'/);
 assert.match(worldCss,/\.onece-world-tabs button\.is-active::after/);
 assert.match(worldCss,/@media\(max-width:680px\)/);
 assert.match(worldCss,/#09080e|#a78bfa/);
});
test('Following uses current users real relationships; For you never invents posts',()=>{
 assert.match(world,/getProfileFollowsV2\(viewerId,controller\.signal\)/);
 assert.match(world,/Array\.isArray\(result\.followingUsers\)/);
 assert.match(world,/profilePictureV2\(person\)/);
 assert.match(world,/onOpenProfile\(person\.username\|\|String\(person\.id\)\)/);
 assert.match(world,/subscribeV2DataChanges\(\['follows'\]/);
 assert.match(world,/return\(\)=>controller\.abort\(\)/);
 assert.match(world,/viewerId===viewerId\?following:EMPTY/);
 assert.match(world,/Recommendations will appear here when the World feed is available/);
 assert.doesNotMatch(world,/\/api\/public\/publish|fakeProject|mockArtist/);
});
