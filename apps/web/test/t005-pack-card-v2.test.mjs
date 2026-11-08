import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const details=read('library-items-v2.tsx');
const workspace=read('workspace-v1.tsx');

test('Home and Profile use the original inline pack page',()=>{
 assert.match(details,/openedPack&&detailOrigin==='home'\?packDetail/);
 assert.match(details,/profilePackPage\?\(packDetail\|\|profilePackMessage\)/);
 assert.match(workspace,/active=\{activeProfileKey===profileKey&&!profilePackVisible\}/);
 assert.doesNotMatch(details,/className="v2-pack-detail-layer"/);
});
test('original Back control closes the pack and preserves its origin',()=>{
 assert.match(details,/const packDetail=openedPack\?<div className="library-pack-detail v2-pack-detail">\s*<button[^>]*className="library-pack-back"[^>]*onClick=\{closeProjectDetails\}/);
 assert.match(details,/detailOrigin==='profile'\?'Back to Profile':'Back to Home'/);
 assert.match(details,/setOpenedBeat\(null\);setOpenedPack\(null\);setOpenedTracks\(\[\]\)/);
});
test('pack actions and global player are preserved',()=>{
 assert.match(details,/aria-label="Shuffle pack"/);
 assert.match(details,/onClick=\{\(\)=>playPack\(openedPack\)\}/);
 assert.match(details,/import PlayerDockV2 from '\.\/player-dock-v2'/);
 assert.doesNotMatch(details,/new Audio\(/);
});
