import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
const workspace=read('workspace-v1.tsx');
const world=read('world-v2.tsx');
const worldCss=read('world-v2.css');

test('World stays mounted and is activated per view like the other workspace views',()=>{
 assert.match(workspace,/<WorldV2 active=\{view==='discover'\} userId=\{account\?\.id\}/);
 // No more conditional curation: the old ternary mount must be gone.
 assert.doesNotMatch(workspace,/view==='discover'\?<WorldV2/);
 // The shared view chain skips rendering for the always-mounted World.
 assert.match(workspace,/view==='library'\|\|view==='profile'\|\|view==='discover'\?null:/);
});

test('inactive World pauses subscriptions, focus resume and data fetching',()=>{
 assert.match(world,/if\(!active\)return;return subscribeV2DataChanges\(\['follows'\]/);
 assert.match(world,/if\(!active\)return;return subscribeV2Resume\(/);
 assert.match(world,/if\(!active\|\|tab!=='following'\|\|!viewerId\)return;/);
});

test('returning to World keeps verified Following data and revalidates once',()=>{
 // Per activation bump: a revalidation runs when the view becomes active again.
 assert.match(world,/if\(active&&!previouslyActive\.current\)setRefresh\(value=>value\+1\)/);
 // Same-viewer revalidation retains the verified list instead of loading state.
 assert.match(world,/setFollowing\(previous=>previous\.viewerId===viewerId\s*\n\s*\?previous/);
 assert.doesNotMatch(world,/setFollowing\(\{viewerId,status:'loading'/);
});

test('account switch isolates Following state while the World stays mounted',()=>{
 // State is cleared as soon as the viewer changes, before any fetch for it runs.
 assert.match(world,/useEffect\(\(\)=>\{setFollowing\(EMPTY\)\},\[viewerId\]\)/);
 // Display is still gated per viewer as a second isolation line.
 assert.match(world,/visibleFollowing=following\.viewerId===viewerId\?following:EMPTY/);
});

test('inactive World is hidden from layout and assistive technology',()=>{
 assert.match(world,/onece-world-inactive/);
 assert.match(world,/aria-hidden=\{active\?undefined:true\}/);
 assert.match(worldCss,/\.onece-world\.onece-world-inactive\{display:none!important\}/);
});
