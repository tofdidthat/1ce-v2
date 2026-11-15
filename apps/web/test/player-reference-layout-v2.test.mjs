import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const player=read('library-items-v2.tsx');
const dock=read('player-dock-v2.tsx');
const waveform=read('player-waveform-v2.ts');
const css=read('library-items-v2.css');
const shellCss=read('workspace-v1.css');

test('player matches the reference capsule proportions, not a longer waveform',()=>{
 assert.match(css,/width: min\(860px, calc\(100% - 32px\)\)/);
 assert.match(css,/grid-template-columns: 42px minmax\(110px, 145px\) minmax\(150px, 190px\) auto auto/);
 assert.match(css,/\.onece-player-wave \{[^}]*max-width: 190px/);
 assert.match(css,/\.onece-player-transport,\.onece-player-options \{ display: flex; align-items: center; gap: 6px; \}/);
 assert.match(css,/\.v2-active-player \.onece-player-controls \.onece-player-icon\{\s*width:40px;height:40px/);
 assert.doesNotMatch(shellCss,/\.onece-player-dock\s*\{/);
 assert.doesNotMatch(shellCss,/\.onece-global-player\s*\{/);
});
test('transport and auxiliary buttons are grouped without changing their order/actions',()=>{
 const start=dock.indexOf('<div className="onece-player-controls">');
 const end=dock.indexOf('  {playerError&&<p className="onece-player-error"',start);
 assert.ok(start>=0&&end>start);
 const controls=dock.slice(start,end);
 assert.match(controls,/className="onece-player-transport" role="group" aria-label="Transport controls"/);
 assert.match(controls,/className="onece-player-options" role="group" aria-label="Playback options"/);
 const labels=['title="Previous"',"title={playing?'Pause':'Play'}",'title="Next"','title="Shuffle"', "title={'Repeat: '+repeat}",'title="Playback queue"','title="Volume"'];
 const locations=labels.map(x=>controls.indexOf(x));
 assert.ok(locations.every(x=>x>=0),'all seven original buttons must remain');
 assert.deepEqual(locations,[...locations].sort((a,b)=>a-b),'reference order must stay unchanged');
 for(const callback of ['onClick={previous}','onClick={toggle}','onClick={next}','onClick={()=>setShuffle(v=>!v)}',"onClick={()=>setPopup(v=>v==='queue'?null:'queue')}","onClick={()=>setPopup(v=>v==='volume'?null:'volume')}"])
  assert.ok(controls.includes(callback),callback);
 assert.match(controls,/onClick=\{\(\)=>setRepeat\(/);
});
test('player remains one accessible portal with responsive waveform and upward vertical volume',()=>{
 assert.match(player,/current&&createPortal\(<div className="onece-player-dock/);
 assert.match(player,/current&&createPortal\(<audio ref=\{audioRef\}/);
 assert.match(player,/aria-label="Playback position"/);
 assert.match(dock,/upcomingQueueV2\(queue,current\)/);
 assert.match(css,/@media\(max-width:760px\)/);
 assert.match(css,/\.onece-player-wave \{ grid-column: 1 \/ -1; grid-row: 2; height: 28px; max-width: none; \}/);
 assert.match(css,/@media\(max-width:390px\)/);
 assert.match(css,/\.onece-player-volume \.v2-volume-popup\{/);
 assert.match(css,/writing-mode:vertical-lr/);
 assert.match(css,/bottom:calc\(100% \+ 6px\);right:-5px;width:46px/);
 assert.match(css,/padding:14px 6px;gap:0;border-radius:23px/);
 assert.doesNotMatch(css,/bottom:-6px;right:-5px;width:46px/);
 assert.match(css,/\.v2-volume-track\{height:126px/);
 assert.match(css,/height:120px;width:18px;margin:0;padding:0;border:0;border-radius:0/);
 // The active single speaker icon still owns the volume toggle.
 assert.match(dock,/onClick=\{\(\)=>setPopup\(v=>v==='volume'\?null:'volume'\)\}/);
 assert.match(css,/\.onece-player-volume > \.onece-player-icon \{ position: relative; z-index: 2; \}/);
 assert.match(css,/bottom: max\(32px, env\(safe-area-inset-bottom\)\)/);
 assert.doesNotMatch(css,/bottom:calc\(100% \+ 2px\)/);
 assert.match(css,/#a78bfa/);
});

test('one persistent audio owner delegates only dock rendering and owner-scoped waveform data',()=>{
 assert.match(player,/<PlayerDockV2 current=\{current\} coverUrl=\{coverUrl\} waveBars=\{waveBars\}/);
 assert.equal((player.match(/createPortal\(<audio ref=\{audioRef\}/g)||[]).length,1);
 assert.doesNotMatch(dock,/<audio\b|new Audio\(|useState\(|useEffect\(|createPortal\(/);
 assert.match(waveform,/\/api\/public\/waveform\//);
 assert.doesNotMatch(waveform,/AudioContext|decodeAudioData|arrayBuffer\(/);
 assert.match(player,/useWaveform\(current\?\.audio_file_id/);
 assert.match(player,/loadWaveform\(b.audio_file_id,userId\)/);
});
