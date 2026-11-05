import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const menu=read('project-context-menu-v2.tsx');
const home=read('library-items-v2.tsx');
const profile=read('public-profile-v2.tsx');
const dialog=read('project-action-dialog-v2.tsx');
const download=read('owner-download-v2.ts');
const zip=read('zip-archive-v2.ts');

test('pack context menu offers Download, beat offers MP3 and owner-only Upload/Download Stems',()=>{
 assert.match(menu,/project.kind==='pack'\?'Download':'Download MP3'/);
 assert.match(menu,/onDownload,!onDownload/);
 assert.match(menu,/item\('Upload\/Download Stems',[^\n]*onAction\('stems'\)/);
 assert.match(menu,/\{owner&&/);
 assert.match(menu,/!owner&&/);
 assert.match(home,/onDownload=\{downloadBusy\?undefined:\(\)=>void downloadOwnerProject\(\{kind:'pack'/);
 assert.match(home,/onDownload=\{downloadBusy\?undefined:\(\)=>void downloadOwnerProject\(\{kind:'beat'/);
});
test('owner profiles can download originals while nonowner MP3 picker stays as before',()=>{
 assert.match(profile,/if\(ownerOf\(project\)\)\{/);
 assert.match(profile,/await downloadOwnedProjectV2\(/);
 assert.match(profile,/const manifest=await fetchPlayableProjectV2/);
 assert.match(profile,/setDownloadPicker\(\{project,tracks:manifest.tracks/);
 assert.match(profile,/onDownload=\{downloadBusy\?undefined:\(\)=>void beginDownload\(menu.project\)\}/);
});
test('stems action uses verified existing upload protocol and transactional owner-only reference',()=>{
 assert.match(dialog,/export type ProjectAction='add'\|'rename'\|'cover'\|'stems'\|'delete'/);
 assert.match(dialog,/ownedBeatFilesV2\(project.id,controller.signal\)/);
 assert.match(dialog,/kind:'stems',name:file.name,contentType:mime,size:file.size,sha256/);
 assert.match(dialog,/fetch\(init.uploadUrl,\{method:'PUT'/);
 assert.match(dialog,/\/api\/library\/files\/\+id\+'\/complete'/);
 assert.match(dialog,/root\+'beat\/'\+project.id,'PATCH',\{stemsFileId\}/);
 assert.match(dialog,/downloadOwnedStemsV2\(stemsId,project.title\)/);
 assert.match(dialog,/type="file" accept=".zip,application\/zip"/);
});
test('pack ZIP uses Home owner manifest, original audio and optional private stems, preserving pack order',()=>{
 assert.match(download,/\/api\/library\/files\/pack-tracks\//);
 assert.match(download,/\/api\/library\/files\/beat\//);
 assert.match(download,/\/api\/library\/files\/\+kind\+'\/\+id/);
 assert.match(download,/for\(const \[index,beat\] of beats.entries\(\)\)/);
 assert.match(download,/entries.push\(\{name:folder\+'\/'\+label\+'\.'\+audio.extension,body:audio.blob\}\)/);
 assert.match(download,/entries.push\(\{name:folder\+'\/stems\/'\+label\+'\.zip',body:stems.blob\}\)/);
 assert.match(download,/zipArchiveV2\(entries,signal\)/);
 assert.match(download,/bytes>750\*1024\*1024/);
 assert.doesNotMatch(download,/POST|PUT|DELETE/);
});
test('ZIP writer has structural CRC32, UTF-8, central-directory and size bounds',()=>{
 assert.match(zip,/0x04034b50/);
 assert.match(zip,/0x02014b50/);
 assert.match(zip,/0x06054b50/);
 assert.match(zip,/0xedb88320/);
 assert.match(zip,/0x0800/);
 assert.match(zip,/if\(!entries.length\|\|entries.length>1024\)/);
 assert.match(zip,/if\(signal\?\.aborted\)/);
 assert.match(zip,/new Blob\(\[\.\.\.parts,\.\.\.central,end.bytes\]/);
});
