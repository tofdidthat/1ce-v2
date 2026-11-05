import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=n=>readFileSync(new URL('../src/'+n,import.meta.url),'utf8');
const menu=source('project-context-menu-v2.tsx');
const profile=source('public-profile-v2.tsx');
const workspace=source('workspace-v1.tsx');
const player=source('library-items-v2.tsx');
const actions=source('public-project-actions-v2.ts');
test('nonowner order: save, copy, queue, download',()=>{
 const lines=['item(saved?',"item('Copy link'","item('Add to queue'","item('Download MP3'"].map(s=>menu.indexOf(s));
 assert.ok(lines.every(n=>n>=0));
 assert.deepEqual(lines,[...lines].sort((a,b)=>a-b));
 assert.ok(menu.includes('!owner&&'));
 assert.ok(profile.includes('onDownload={!ownerOf(menu.project)'));
});
test('queue appends authorized manifest tracks without replacing current audio',()=>{
 assert.ok(workspace.includes('queueRequest={queueRequest}'));
 assert.ok(workspace.includes('onQueueProject={requestQueue}'));
 assert.ok(player.includes('fetchPlayableProjectV2(ownerId,kind,id,controller.signal)'));
 assert.ok(player.includes('setQueue(previous=>appendDistinctQueueV2(previous,tracks))'));
 assert.ok(player.includes('tracksFromPlayableProjectV2(project)'));
 assert.ok(player.includes('createPortal(<div className="onece-player-dock'));
 assert.doesNotMatch(player,/setQueue\(previous=>\[\.\.\.previous,\.\.\.tracks\]\)/);
 assert.ok(player.includes('if(!currentRef.current)'));
});
test('other-user Copy link uses stable public profile route without private token',()=>{
 assert.ok(profile.includes('publicProjectLinkV2(window.location.origin,project.owner_id,project.kind,project.id)'));
 assert.ok(actions.includes("url.searchParams.set('project'"));
 assert.ok(profile.includes("get('project')"));
 assert.ok(profile.includes("scrollIntoView({block:'center'})"));
});
test('MP3 uses existing authorized audio endpoint and a pack track picker',()=>{
 assert.ok(actions.includes('/api/public/audio/'));
 assert.ok(actions.includes('/api/public/play/'));
 assert.ok(actions.includes("response.blob()"));
 assert.ok(actions.includes("safeMp3NameV2(track.title)"));
 assert.ok(profile.includes('downloadPicker.tracks.map(track'));
 assert.ok(profile.includes('downloadAuthorizedMp3V2('));
});
