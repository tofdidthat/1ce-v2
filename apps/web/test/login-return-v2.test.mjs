import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
const login=readFileSync(new URL('../src/login.tsx',import.meta.url),'utf8');

test('landing enters the library when a session exists and does not show a login interstitial',()=>{
 assert.match(main,/if\(enter\)return <Navigate to="\/app\/library" replace\/>/);
 assert.doesNotMatch(main,/Checking session/);
 assert.doesNotMatch(main,/Completing Google sign-in/);
 assert.doesNotMatch(main,/function GoogleReturn/);
 assert.match(main,/path="\/app" element=\{<LoginPage\/>\}/);
});

test('Google return stays on the login card and retries one transient failure',()=>{
 assert.match(login,/for\(let attempt=0;attempt<2;attempt\+\+\)/);
 assert.match(login,/googleJobs/);
 assert.match(login,/login=error/);
 assert.doesNotMatch(login,/Back to login/);
});
