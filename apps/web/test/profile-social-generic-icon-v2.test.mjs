import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const links=read('profile-social-links-v2.tsx');
const glyph=read('copy-link-icon-v2.tsx');
const editorCss=read('edit-profile-panel-v2.css');
const profileCss=read('public-profile-v2.css');
const profile=read('public-profile-v2.tsx');
const editor=read('edit-profile-panel-v2.tsx');

test('both generic social links reuse exact diagonal chain Copy Link glyph',()=>{
 assert.match(glyph,/import \{Link\} from 'lucide-react'/);
 assert.match(glyph,/return <Link size=\{size\}\/>/);
 assert.match(links,/import CopyLinkIconV2 from '\.\/copy-link-icon-v2'/);
 assert.match(links,/return <CopyLinkIconV2 size=\{size\}\/>/);
 assert.doesNotMatch(links,/<Link2 size=\{size\}/);
 assert.match(links,/className=\{'onece-social-link'\+\(platformForProfileLinkV2\(url\)==='link'\?' is-generic':''\)\}/);
 assert.match(profile,/<ProfileSocialLinksV2 compact links=/);
 assert.match(editor,/<ProfileSocialLinksV2 links=\{links\}/);
 // Spotify, YouTube and Instagram have not been replaced.
 for(const host of ['spotify.com','youtube.com','instagram.com'])assert.ok(links.includes(host));
});

test('public generic chain has no pill, border or background even when hovered',()=>{
 assert.match(profileCss,/\.onece-profile-top \.onece-social-links\.is-compact \.onece-social-link\.is-generic\{/);
 assert.match(profileCss,/\.onece-profile-top \.onece-social-links\.is-compact \.onece-social-link\.is-generic:hover\{/);
 assert.match(profileCss,/padding:0;border:0;background:transparent;box-shadow:none/);
 assert.match(profileCss,/border:0;background:transparent;box-shadow:none;color:#fff/);
});

test('editor link and plus share 44px grid, left edge, centered without background',()=>{
 assert.match(editorCss,/\.onece-edit-links \.onece-social-links\{display:flex;align-items:center;justify-content:flex-start;gap:0\}/);
 assert.match(editorCss,/\.onece-edit-links \.onece-social-link,\.onece-edit-links \.onece-social-add\{display:grid;place-items:center;flex:0 0 44px;width:44px;height:44px;margin:0;padding:0\}/);
 assert.match(editorCss,/\.onece-edit-links \.onece-social-link\.is-generic\{border:0;background:transparent;box-shadow:none\}/);
 assert.match(editorCss,/\.onece-edit-links \.onece-social-link\.is-generic:hover\{background:transparent\}/);
 assert.match(editorCss,/\.onece-edit-links \.onece-social-add:hover\{background:transparent/);
 assert.match(links,/aria-label="Profile links"/);
 assert.match(links,/aria-label="Add profile link"/);
});
