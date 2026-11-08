import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const details=read('library-items-v2.tsx');
const css=read('library-items-v2.css');
const profile=read('public-profile-v2.tsx');

test('Home and Profile open packs in the same centered overlay card',()=>{
 assert.match(details,/const packOverlay=openedPack&&\(detailOrigin==='home'\|\|\(detailOrigin==='profile'&&profileRouteKey!==null\)\)/);
 assert.match(details,/className="v2-pack-detail-layer"/);
 assert.equal((details.match(/className="v2-pack-detail-layer"/g)||[]).length,2);
 assert.match(details,/className="v2-pack-detail-card beat-profile library-page onece-v2-library">\{packDetail\}/);
 // Home keeps its grid mounted behind the overlay instead of replacing it inline.
 assert.doesNotMatch(details,/openedPack&&detailOrigin!=='profile'\?packDetail/);
 assert.doesNotMatch(details,/v2-profile-project-detail-overlay|v2-profile-project-detail-sheet/);
});

test('Back sits outside the pack card and returns to the origin label',()=>{
 assert.match(details,/const packBackLabel=detailOrigin==='profile'\?'Back to Profile':'Back to Home'/);
 assert.match(details,/className="v2-pack-detail-layer"[^>]*>\s*<button[^>]*className="library-pack-back v2-pack-detail-back"[^>]*aria-label=\{packBackLabel\}[^>]*onClick=\{closeProjectDetails\}/);
 assert.match(details,/const packDetail=openedPack\?<div className="library-pack-detail v2-pack-detail">\s*<div className="library-pack-cover/);
 assert.doesNotMatch(details,/const packDetail=openedPack\?<div className="library-pack-detail v2-pack-detail">\s*<button/);
 assert.match(css,/\.v2-pack-detail-back\{[\s\S]*?position:absolute;top:calc\(var\(--v2-detail-card-top\) - 72px\)/);
});

test('Pack card grows with beats while the overlay page scrolls',()=>{
 assert.match(css,/\.v2-pack-detail-overlay\{[\s\S]*?overflow-y:auto[\s\S]*?overscroll-behavior:contain/);
 assert.match(css,/\.v2-pack-detail-overlay\{[\s\S]*?padding:var\(--v2-detail-card-top\) 24px 110px/);
 assert.doesNotMatch(css,/\.v2-pack-detail-card\{[^}]*max-height/);
 assert.doesNotMatch(css,/\.v2-pack-detail-card\{[^}]*overflow/);
 assert.match(details,/\{openedTracks\.map\(\(beat,index\)=>/);
});

test('Pack card top edge matches the single-beat card and stays responsive',()=>{
 assert.match(css,/\.v2-beat-overlay,\.v2-pack-detail-layer\{--v2-detail-card-top:clamp\(96px,20vh,260px\)\}/);
 assert.match(css,/\.v2-beat-overlay\{[^}]*align-items:flex-start[^}]*padding:var\(--v2-detail-card-top\)/);
 assert.match(css,/\.v2-beat-widget\{[^}]*max-height:calc\(100vh - var\(--v2-detail-card-top\) - 48px\)/);
 assert.match(css,/@media\(max-width:680px\)\{\s*\.v2-beat-overlay,\.v2-pack-detail-layer\{--v2-detail-card-top:clamp\(76px,14vh,120px\)\}/);
 assert.match(css,/\.v2-pack-detail-card\{[\s\S]*?width:min\(1050px,100%\)/);
});

test('Closing a pack returns to the same Profile tab without navigation',()=>{
 assert.match(details,/const closeProjectDetails=\(\)=>\{[\s\S]*?setOpenedBeat\(null\);setOpenedPack\(null\);setOpenedTracks\(\[\]\);[\s\S]*?setDetailOrigin\(null\)/);
 assert.doesNotMatch(details,/setTab\(/);
 assert.doesNotMatch(details,/window\.history\.(?:back|go)\(/);
 assert.match(profile,/const \[tab,setTab\]=useState<ProfileTab>\('catalog'\)/);
});

test('Existing pack actions and the global player are preserved',()=>{
 assert.match(details,/aria-label="Shuffle pack"/);
 assert.match(details,/onClick=\{\(\)=>playPack\(openedPack\)\}/);
 assert.match(details,/disabled title="Add tracks is not yet available in v2"/);
 assert.match(details,/aria-label=\{'Open '\+beat\.title\}/);
 assert.match(details,/import PlayerDockV2 from '\.\/player-dock-v2'/);
 assert.doesNotMatch(details,/localStorage\.setItem\(.+pack/);
 assert.doesNotMatch(details,/new Audio\(/);
});
