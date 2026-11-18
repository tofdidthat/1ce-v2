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
test('Home header hides only while its pack page is visible',()=>{
 assert.match(details,/const homePackPage=Boolean\(active&&detailOrigin==='home'&&openedPack\)/);
 assert.match(workspace,/!\(view==='library'&&homePackVisible\)&&<HeaderV2/);
 assert.match(workspace,/onHomePackVisibility=\{setHomePackVisible\}/);
 assert.match(workspace,/view==='library'&&!homePackVisible\?' onece-library-view':''/);
});
test('original Back control closes the pack and preserves its origin',()=>{
 assert.match(details,/const packDetail=openedPack\?<div className=\{["\x27]library-pack-detail v2-pack-detail/);
 assert.match(details,/<button[^>]*className="library-pack-back"[^>]*onClick=\{closeProjectDetails\}/);
 assert.match(details,/detailOrigin==='profile'\?'Back to Profile':'Back to Home'/);
 assert.match(details,/setOpenedBeat\(null\);setOpenedPack\(null\);setOpenedTracks\(\[\]\)/);
});
test('pack actions and global player are preserved',()=>{
 assert.match(details,/aria-label="Shuffle pack"/);
 assert.match(details,/onClick=\{\(\)=>playPack\(openedPack\)\}/);
 assert.match(details,/import PlayerDockV2 from '\.\/player-dock-v2'/);
 assert.doesNotMatch(details,/new Audio\(/);
});

test('pack drop uses the same Home/Profile detail and only permits the owner to add media',()=>{
 assert.match(details,/const canEditOpenedPack=Boolean\(openedPack&&userId&&openedPack\.owner_id===userId\)/);
 assert.match(details,/onDrop=\{event=>/);
 assert.match(details,/if\(!canEditOpenedPack\|\|!isAudioFileDrag\(event\)\)return/);
 assert.match(details,/disabled=\{!canEditOpenedPack\|\|packUploading\}/);
 assert.match(details,/profilePackPage\?\(packDetail\|\|profilePackMessage\)/);
 assert.match(details,/notifyV2DataChanged\(\['library'\],userId\)/);
 assert.doesNotMatch(details,/audioRef\.current\?\.pause\(\);setCurrent\(null\);setQueue\(\[\]\);setPlaying\(false\);\s*setPackUploading/);
});
test('pack drop uploads audio only and attaches with owner-checked atomic endpoint',()=>{
 const upload=read('pack-drop-upload-v2.ts');
 assert.match(upload,/uploadPublishingFile\(api,file,'audio'/);
 assert.match(upload,/\/api\/library\/projects\/pack\//);
 assert.match(upload,/\+'\/audio'/);
 assert.doesNotMatch(upload,/\/api\/library\/files\/beats/);
 assert.match(upload,/signal\.aborted/);
});
