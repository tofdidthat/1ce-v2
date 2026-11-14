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
 assert.match(multi,/selectedYouTubeFormats/);
 assert.match(multi,/aria-pressed=\{selectedPlatforms\.includes\(platform\)\}/);
 assert.match(multi,/aria-pressed=\{selectedYouTubeFormats\.includes\(format\.id\)\}/);
 assert.match(multi,/initialAudio/);
 assert.match(multi,/initialCover/);
 assert.match(multi,/initialTitle/);
});

test('publishing requires connected YouTube and supported media without calling v1',()=>{
 assert.match(multi,/disabled=\{busy\|\|!active\|\|!userId\|\|!currentStatus\?\.available\|\|!currentStatus.connected/);
 assert.match(multi,/Original video publishing is unavailable/);
 assert.match(multi,/pending.current=\{requestId:crypto.randomUUID\(\)/);
 assert.match(multi,/if\(!pending.current\)/);
 assert.match(multi,/signal,pending.current/);
 assert.match(multi,/controller.abort\(\);clearTimeout\(timer\)/);
 assert.doesNotMatch(multi,/\bfetch\s*\(/);
 assert.doesNotMatch(multi,/DESKTOP_BACKEND_URL|ACCOUNT_SESSION_KEY|publishToAll|localStorage/);
});

test('mobile layout and original full-width audio dropzone remain independent',()=>{
 assert.match(css,/@media \(max-width: 760px\)/);
 assert.match(css,/\.onece-multi-grid \{ grid-template-columns: 1fr;/);
 assert.match(css,/\.onece-upload-mode-button \{ min-height: 54px; \}/);
});

test('9:16 and 16:9 are YouTube-only options, not global platform settings',()=>{
 assert.match(multi,/const youtubeSelected=selectedPlatforms\.includes\('YouTube'\)/);
 assert.match(multi,/\{youtubeSelected&&<div className="onece-multi-youtube-options">/);
 assert.match(multi,/aria-label="YouTube video formats"/);
 assert.match(multi,/format\.id==='vertical'\?'Shorts':'Standard video'/);
 assert.match(multi,/const previewFormats=youtubeSelected[\s\S]*?selectedYouTubeFormats\.includes\(format\.id\)[\s\S]*?format\.id==='vertical'/);
 assert.match(multi,/previewFormats\.map\(format=>/);
 assert.doesNotMatch(multi,/<h2>Video formats<\/h2>/);
 assert.match(css,/\.onece-multi-youtube-options \{/);
});
