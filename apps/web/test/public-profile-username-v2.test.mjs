import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const profile=read('public-profile-v2.tsx');

test('public profile has exactly one username line, without @ prefix or secondary display name',()=>{
 assert.match(profile,/<h1>\{handle\?handle\.replace\(\/\^@\/,'\'\):name\}<\/h1>/);
 assert.doesNotMatch(profile,/<p className="onece-profile-display-name">/);
 assert.doesNotMatch(profile,/handle\?'@'\+handle/);
 assert.match(profile,/const handle=String\(shownUser\?\.username\|\|shownUser\?\.handle\|\|''\)/);
 assert.match(profile,/className="onece-profile-avatar"/);
});

test('original Library tab icon and other profile tabs remain unmodified',()=>{
 assert.match(profile,/\{id:'catalog',label:'Catalog',icon:<CatalogLibraryIcon\/>\}/);
 assert.match(profile,/\{id:'saves',label:'Saves',icon:<Bookmark size=\{16\}\/>\}/);
 assert.match(profile,/\{id:'following',label:'Following',icon:<Users size=\{16\}\/>\}/);
 assert.match(profile,/<nav className="onece-profile-tabs"/);
 assert.match(profile,/\{tabs\.map\(t=><button/);
});
