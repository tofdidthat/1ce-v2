import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const profile=source('public-profile-v2.tsx');
const flags=source('project-flags-v2.tsx');
const main=source('main.tsx');
const api='../../api/src/server.js';

test('anonymous public profiles do not show signed-in-only Save/Publish status messages',()=>{
 assert.match(profile,/Boolean\(user\?\.id\)&&flagsStatus==='loading'/);
 assert.match(profile,/Boolean\(user\?\.id\)&&flagsStatus==='error'/);
 assert.match(profile,/flagsError\}<button type="button" onClick=\{retryFlags\}>Retry/);
 // Genuine public-profile fetch errors are still shown and actionable.
 assert.match(profile,/\{error&&<p role="alert"/);
 assert.match(profile,/profileStatus==='error'&&<button type="button"/);
});
test('anonymous access does not enable project mutations',()=>{
 assert.match(profile,/onPublish=\{flagsStatus==='ready'\?/);
 assert.match(profile,/onSave=\{flagsStatus==='ready'\?/);
 assert.match(flags,/if\(!id\)throw Error\('Sign in to manage projects'\)/);
 assert.match(flags,/if\(status!=='ready'\)throw Error/);
});
test('public route remains available without ProtectedLibrary authentication',()=>{
 assert.match(main,/<Route path="\/u\/:id" element=\{<PublicUserPage\/>\}/);
 assert.match(main,/function PublicUserPage\(\)/);
 assert.match(main,/function ProtectedLibrary\(\)/);
 assert.match(main,/<Navigate to="\/login" replace\/>/);
});
