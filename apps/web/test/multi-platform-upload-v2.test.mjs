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
 assert.match(multi,/aria-pressed=\{selected\.includes\(platform\)\}/);
 assert.match(multi,/aria-pressed=\{selectedYouTubeFormats\.includes\(format\.id\)\}/);
 assert.match(multi,/initialAudio/);
 assert.match(multi,/initialCover/);
 assert.match(multi,/initialTitle/);
});

test('publishing requires connected selected destinations and supported media without calling v1',()=>{
 assert.match(multi,/disabled=\{accepted\|\|busy\|\|!active\|\|!userId/);
 assert.match(multi,/!destinationsValid\|\|!youtubeReady\|\|!instagramReady/);
 assert.match(multi,/instagramPublicConsent:true/);
 assert.doesNotMatch(multi,/setInstagramPublicConsent|onece-multi-public-confirmation/);
 assert.match(multi,/createPortal\(/);
 assert.match(multi,/className="onece-multi-destination-trigger"/);
 assert.match(multi,/aria-expanded=\{open\}/);
 assert.match(multi,/document\.addEventListener\('pointerdown'/);
 assert.match(multi,/event\.key==='Escape'/);
 assert.match(multi,/selected\.length\+' selected'/);
 assert.match(multi,/Publish to YouTube \+ public Instagram Reel/);
 assert.match(css,/\.onece-multi-destination-popover/);
 assert.match(multi,/Publish public Instagram Reel/);
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
 assert.match(multi,/\{youtube&&<button type="button" className="onece-multi-destination-more"/);
 assert.match(multi,/title="YouTube formats" aria-label="YouTube formats"/);
 assert.match(multi,/onClick=\{\(\)=>setYoutubeFormatsOpen\(value=>!value\)\}/);
 assert.match(multi,/aria-controls=\{formatsId\} aria-expanded=\{youtubeFormatsOpen\}/);
 assert.match(multi,/\{youtube&&youtubeFormatsOpen&&<div id=\{formatsId\}/);
 assert.match(multi,/aria-label="YouTube video formats"/);
 assert.match(multi,/onToggleYouTubeFormat\(format\.id\)/);
 assert.match(multi,/format\.id==='vertical'\?'Shorts 9:16':'Standard 16:9'/);
 assert.match(multi,/selectedYouTubeFormats=\{selectedYouTubeFormats\}/);
 assert.match(multi,/onToggleYouTubeFormat=\{toggleYouTubeFormat\}/);
 assert.match(multi,/const previewFormats=youtubeSelected[\s\S]*?selectedYouTubeFormats\.includes\(format\.id\)[\s\S]*?format\.id==='vertical'/);
 assert.match(multi,/previewFormats\.map\(format=>/);
 assert.doesNotMatch(multi,/onece-multi-youtube-options|Choose Shorts \(9:16\), standard video/);
 assert.match(css,/\.onece-multi-destination-more \{/);
 assert.match(css,/\.onece-multi-youtube-formats \{/);
 assert.doesNotMatch(css,/\.onece-multi-youtube-options \{/);
});
