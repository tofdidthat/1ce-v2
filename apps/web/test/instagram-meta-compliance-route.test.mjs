import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('legacy Meta callback path reaches the V2 signed callback before the SPA catch-all',()=>{
 const vercel=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
 const route=vercel.rewrites.find(rule=>rule.source==='/api/instagram/auth');
 const spa=vercel.rewrites.findIndex(rule=>rule.source==='/((?!assets/).*)');
 assert.ok(route);
 assert.equal(route.destination,'https://1ce-v2-production.up.railway.app/api/instagram/meta-compliance');
 assert.ok(vercel.rewrites.indexOf(route)<spa);
});
