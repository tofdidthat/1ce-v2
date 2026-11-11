import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const home=readFileSync(new URL('../src/library-upload-v1.tsx',import.meta.url),'utf8');
const multi=readFileSync(new URL('../src/multi-platform-upload-v2.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/multi-platform-upload-v2.css',import.meta.url),'utf8');

test('1CE Upload button is placed below the Home upload card and switches modes',()=>{
 const button=home.indexOf('className="onece-upload-mode-entry"');
 const cardClose=home.lastIndexOf('</div>',button);
 const homeEnd=home.indexOf('</section>',cardClose);
 assert.ok(cardClose>=0 && button>cardClose && homeEnd>button);
 assert.match(home,/hidden=\{multiPlatform\}/);
 assert.match(home,/onClick=\{\(\)=>setMultiPlatform\(true\)\}/);
 assert.match(home,/<MultiPlatformUploadV2 active=\{multiPlatform\}/);
 assert.match(multi,/onBack:.*void;/);
 assert.match(multi,/onClick=\{onBack\}/);
 assert.match(multi,/hidden=\{!active\}/);
});

test('Home upload API, save action and library refresh remain present',()=>{
 for(const required of [
  "const save=async()=>",
  "/api/library/files/init",
  "/api/library/files/beats",
  "/api/library/files/packs",
  "notifyV2DataChanged(['library'],userId)",
  "navigate('/app/library',{replace:true})"
 ]) assert.ok(home.includes(required),required);
});

test('multiplatform mode supports original v1 destination choices and two formats',()=>{
 for(const platform of ['YouTube','TikTok','Instagram','Telegram','Discord']){
  assert.ok(multi.includes("'"+platform+"'"),platform);
 }
 assert.match(multi,/ratio:'9:16'/);
 assert.match(multi,/ratio:'16:9'/);
 assert.match(multi,/selectedFormats/);
 assert.match(multi,/aria-pressed=\{selectedPlatforms\.includes\(platform\)\}/);
 assert.match(multi,/aria-pressed=\{selectedFormats\.includes\(format\.id\)\}/);
 assert.match(multi,/initialAudio/);
 assert.match(multi,/initialCover/);
 assert.match(multi,/initialTitle/);
});

test('unconnected publishing remains explicitly disabled and cannot call v1 services',()=>{
 assert.match(multi,/<button type="button" disabled aria-label="Publishing to external platforms is coming soon">/);
 assert.match(multi,/Preview mode only/);
 assert.doesNotMatch(multi,/\bfetch\s*\(/);
 assert.doesNotMatch(multi,/DESKTOP_BACKEND_URL|ACCOUNT_SESSION_KEY|publishToAll|localStorage/);
});

test('mobile layout and original full-width audio dropzone remain independent',()=>{
 assert.match(css,/@media \(max-width: 760px\)/);
 assert.match(css,/\.onece-multi-grid \{ grid-template-columns: 1fr;/);
 assert.match(css,/\.onece-upload-mode-button \{ min-height: 54px; \}/);
});
