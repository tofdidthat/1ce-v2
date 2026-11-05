import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const card=read('project-card-v2.tsx');
const profile=read('public-profile-v2.tsx');
const workspace=read('workspace-v1.tsx');
const details=read('library-items-v2.tsx');
const api=read('public-project-actions-v2.ts');
const readModel=read('project-read-v2.ts');

test('Home and Profile cards call the same open behavior without hijacking Play or right click',()=>{
 assert.match(card,/onOpen\?:\(\)=>void/);
 assert.match(card,/onece-profile-project-art'[\s\S]*?onClick=\{onOpen\}/);
 assert.match(card,/event\.target===event\.currentTarget/);
 assert.match(card,/event\.stopPropagation\(\);onPlay\(\)/);
 assert.match(profile,/onOpen=\{onOpenProject\?\(\)=>onOpenProject\(project\.owner_id,project\.kind,project\.id\)/);
 assert.match(profile,/onContextMenu=\{event=>\{event\.preventDefault\(\);setMenu\(/);
 assert.match(workspace,/onOpenProject=\{requestOpen\}/);
 assert.match(workspace,/openRequest=\{openRequest\}/);
});
test('Catalog and Saves open original UUID/owner through the same API-authorized Home detail renderer',()=>{
 assert.match(details,/const \{ownerId,kind,id\}=openRequest/);
 assert.match(details,/fetchPlayableProjectV2\(ownerId,kind,id,controller\.signal\)/);
 assert.match(details,/tracksFromPlayableProjectV2\(project\)/);
 assert.match(details,/const packDetail=openedPack\?</);
 assert.equal((details.match(/className="library-pack-detail v2-pack-detail"/g)||[]).length,1);
 assert.match(details,/openedPack&&detailOrigin!=='profile'\?packDetail/);
 assert.match(details,/detailOrigin==='profile'&&openedPack&&profileRouteKey!==null&&createPortal/);
 assert.match(details,/\{openedBeat&&createPortal\(/);
 assert.match(details,/ownerId=\{openedPack\.owner_id\}/);
 assert.match(details,/ownerId=\{openedBeat\.owner_id\}/);
 assert.match(details,/toggleSaved\(openedBeat\.owner_id,'beat',openedBeat\.id\)/);
 assert.match(details,/playPack=async\(p:PackItem\)[^\n]*fetchPlayableProjectV2\(p\.owner_id,'pack',p\.id\)/);
 assert.match(api,/return parsePlayableProjectV2\(payload,\{ownerId,kind,id\}\)/);
});
test('Opening project details never creates copies or new access grants',()=>{
 assert.match(readModel,/normalizeProfileProjectsV2\(payload:unknown\)/);
 assert.match(profile,/const key=savedProjectKeyV2\(project\.owner_id,project\.kind,project\.id\)/);
 assert.match(details,/profileRouteKey\?:string\|null/);
 assert.match(details,/detailRequest\.current\?\.abort\(\)/);
 for(const source of [card,profile,workspace,details]){
  assert.doesNotMatch(source,/new (?:MediaRecorder|Audio)\(/);
  assert.doesNotMatch(source,/localStorage\.setItem\(.+project/);
 }
});
