import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {checkTypeScriptPolicy} from '../../../scripts/check-typescript-policy.mjs';

function fixture(run){
 const root=mkdtempSync(join(tmpdir(),'1ce-ts-policy-'));
 const write=(path,content)=>{
  const target=join(root,path);
  mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,content);
 };
 try {
  for(const path of ['apps/api/tsconfig.json','apps/web/tsconfig.json'])
   write(path,JSON.stringify({compilerOptions:{strict:true,allowJs:false}}));
  write('apps/api/src/server.ts','export const ok = true;');
  write('apps/web/src/main.tsx','export const ok = true;');
  write('packages/shared/contracts.d.ts','export type AccountIdV2=number;');
  run({root,write});
 } finally {
  rmSync(root,{recursive:true,force:true});
 }
}
test('TypeScript production policy permits strict TypeScript sources',()=>{
 fixture(({root})=>assert.deepEqual(checkTypeScriptPolicy(root,new Set()),[]));
});
test('TypeScript policy finds JavaScript modules recursively in both apps',()=>{
 fixture(({root,write})=>{
  write('apps/api/src/feature/deep/legacy.js','export const wrong = true;');
  write('apps/web/src/components/legacy.jsx','export const wrong = true;');
  write('packages/shared/internals/legacy.mjs','export const wrong = true;');
  const errors=checkTypeScriptPolicy(root,new Set());
  assert.ok(errors.some(x=>x.includes('feature/deep/legacy.js')));
  assert.ok(errors.some(x=>x.includes('components/legacy.jsx')));
  assert.ok(errors.some(x=>x.includes('packages/shared/internals/legacy.mjs')));
 });
});
test('TypeScript policy fails closed when strictness is relaxed',()=>{
 fixture(({root,write})=>{
  write('apps/api/tsconfig.json',JSON.stringify({compilerOptions:{strict:false,allowJs:true}}));
  write('apps/web/src/unsafe.tsx','// @ts-nocheck\nexport const unsafe = true;');
  const errors=checkTypeScriptPolicy(root,new Set());
  assert.ok(errors.some(x=>x.includes('allowJs must remain false')));
  assert.ok(errors.some(x=>x.includes('strict must remain true')));
  assert.ok(errors.some(x=>x.includes('@ts-nocheck forbidden')));
 });
});
test('TypeScript policy rejects @ts-ignore and stale exceptions',()=>{
 fixture(({root,write})=>{
  write('apps/web/src/ignored.ts','// @ts-ignore\nexport const ignore = 1;');
  write('apps/api/src/hidden.ts','/* @ts-nocheck */\nexport const hidden = true;');
  const errors=checkTypeScriptPolicy(root,new Set(['apps/web/src/missing.tsx']));
  assert.ok(errors.some(x=>x.includes('@ts-ignore forbidden')));
  assert.ok(errors.some(x=>x.includes('apps/api/src/hidden.ts: @ts-nocheck forbidden')));
  assert.ok(errors.some(x=>x.includes('stale @ts-nocheck exemption')));
 });
});
