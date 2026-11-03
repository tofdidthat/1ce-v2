import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const profile=src('public-profile-v2.tsx');
const menu=src('project-context-menu-v2.tsx');
const library=src('library-items-v2.tsx');
const glyph=src('copy-link-icon-v2.tsx');
const panel=src('edit-profile-panel-v2.tsx');
const css=src('edit-profile-panel-v2.css');
const social=src('profile-social-links-v2.tsx');

test('Back uses exactly the same 20px ChevronLeft as opened pack; header layout unchanged',()=>{
 assert.match(library,/<ChevronLeft size=\{20\}\/>/);
 assert.match(profile,/className="library-settings onece-profile-nav-back"[^>]*><ChevronLeft size=\{20\}\/>/);
 assert.doesNotMatch(profile,/<ArrowLeft/);
 assert.match(profile,/className="onece-workspace-header onece-profile-navbar"/);
 assert.match(profile,/onClick=\{onBack\}/);
});

test('the new angled Link glyph is shared by right-click Copy link and the profile header',()=>{
 assert.match(glyph,/import \{Link\} from 'lucide-react'/);
 assert.match(glyph,/return <Link size=\{size\}\/>/);
 assert.match(menu,/item\('Copy link',<CopyLinkIconV2 size=\{17\}\/>/);
 assert.match(profile,/aria-label="Copy profile link"/);
 assert.match(profile,/<CopyLinkIconV2 size=\{22\}\/><\/button>/);
 assert.doesNotMatch(menu,/<Link2 size=/);
 assert.match(profile,/navigator\.clipboard\.writeText\(url\)/);
 assert.match(menu,/onShare/);
 // Generic social URLs reuse the same diagonal Copy Link glyph.
 assert.match(social,/return <CopyLinkIconV2 size=\{size\}\/>/);
});

test('Editor close, save and social Add align to the same 44px transparent button grid',()=>{
 assert.match(css,/\.onece-edit-toolbar\{[^}]*grid-template-columns:44px minmax\(0,1fr\) 44px;align-items:center/);
 assert.match(css,/\.onece-edit-toolbar button\{[^}]*width:44px;height:44px;padding:0;border:0;[^}]*background:transparent/);
 assert.match(css,/\.onece-edit-toolbar button\.onece-edit-save\{background:transparent/);
 assert.match(css,/\.onece-edit-toolbar button:hover:not\(:disabled\)\{background:transparent/);
 assert.match(css,/\.onece-edit-links \.onece-social-add\{flex:0 0 44px;width:44px;height:44px;padding:0;border:0;background:transparent/);
 assert.match(css,/\.onece-edit-links \.onece-social-add:hover\{background:transparent/);
 assert.match(css,/\.onece-edit-toolbar\{[^}]*padding:12px 20px/);
 assert.match(css,/\.onece-edit-sections\{[^}]*padding:8px 20px/);
 assert.match(panel,/aria-label="Close editor"/);
 assert.match(panel,/aria-label="Save profile"/);
 assert.match(social,/aria-label="Add profile link"/);
 assert.match(panel,/onClick=\{\(\)=>void saveProfile\(\)\}/);
 assert.match(panel,/onAdd=\{links\.length<6\?\(\)=>editLink\(-1\):undefined\}/);
 assert.match(css,/@media\(max-width:620px\)/);
});

test('the visual batch does not replace publish or identity endpoints',()=>{
 assert.match(panel,/togglePublished\(project\.kind,project\.id\)/);
 assert.match(panel,/jsonRequest\('\/auth\/me'/);
 assert.match(panel,/jsonRequest\('\/auth\/me\/avatar'/);
 assert.match(panel,/fetch\(api\+'\/api\/library\/files\/items'/);
});
