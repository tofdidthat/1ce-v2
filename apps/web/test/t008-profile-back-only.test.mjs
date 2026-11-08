import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const profile=read('public-profile-v2.tsx');
const profileCss=read('public-profile-v2.css');
const workspace=read('workspace-v1.tsx');

// The Profile's top-left slot is one fixed piece of UI: the Back button.
// It must never depend on origin, history state or a caller-supplied flag.
const brand=profile.slice(
 profile.indexOf('<div className="onece-workspace-brand onece-profile-header-brand">'),
 profile.indexOf('<div className="onece-workspace-actions onece-profile-nav-actions">')
);

test('Profile Back is structural and has no conditional flag',()=>{
 assert.match(brand,/<button type="button" className="library-settings onece-profile-nav-back" aria-label="Go back" title="Back" onClick=\{onBack\}>/);
 assert.match(brand,/<ChevronLeft size=\{20\}\/>/);
 assert.doesNotMatch(brand,/showBack/);
 assert.doesNotMatch(profile,/showBack/,'Profile must not accept or read a showBack prop');
 assert.doesNotMatch(profile,/showBack\?:boolean/);
});

test('Profile top-left slot contains only the Back control',()=>{
 assert.equal((brand.match(/<button/g)||[]).length,1,'exactly one button in the top-left slot');
 assert.equal((brand.match(/<a\b/g)||[]).length,0,'no link in the top-left slot');
 assert.equal((brand.match(/<img\b/g)||[]).length,0,'no image or logo in the top-left slot');
 assert.doesNotMatch(brand,/1ce-logo\.png|onece-workspace-logo-home|aria-label="Go to Home"/);
 assert.doesNotMatch(brand,/onece-profile-nav-(copy|edit|follow)/);
});

test('Every Profile origin uses the same unconditional Back button',()=>{
 // Both /u/:id (public) and /app/profile (own, including Home/Settings entry)
 // resolve to the single profile view that renders this header.
 assert.match(workspace,/const view:WorkspaceView=profileId\?'profile':/);
 assert.match(workspace,/:'profile';/);
 assert.match(workspace,/\{view==='profile'\?null:<header className="onece-workspace-header"/);
 assert.doesNotMatch(workspace,/user=\{account\} showBack profileId=/,'Profile caller must not pass showBack');
 assert.match(workspace,/user=\{account\} profileId=\{profileKey==='own'\?undefined:profileKey\.slice\('public:'\.length\)\}/);
});

test('Profile Back keeps history navigation and leaf routes stay untouched',()=>{
 assert.match(workspace,/onBack=\{\(\)=>\{const index=window\.history\.state\?\.idx;if\(typeof index==='number'&&index>0\)navigate\(-1\);else navigate\(account\?\.id\?'\/app\/library':'\/'\);\}\}/);
 assert.match(profile,/onClick=\{onBack\}/);
 assert.match(profile,/onClick=\{\(\)=>void copyProfileLink\(\)\}/);
 assert.match(profile,/onClick=\{\(\)=>setEditorOpen\(true\)\}/);
 assert.match(profile,/onClick=\{\(\)=>void changeFollow\(\)\}/);
});

test('Profile navbar keeps the logo out of its left slot at every breakpoint',()=>{
 const brandRules=[...profileCss.matchAll(/[^{}]*onece-profile-header-brand[^{}]*\{[^}]*\}/g)].map(match=>match[0]);
 assert.equal(brandRules.length,1,'only the left-slot guard may style the profile brand container');
 assert.match(brandRules[0],/display:none!important/);
 assert.match(brandRules[0],/:not\(\.onece-profile-nav-back\)/);
});
