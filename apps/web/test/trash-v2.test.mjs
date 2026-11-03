import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const settings=readFileSync(new URL('../src/account-settings-v2.tsx',import.meta.url),'utf8');
const panel=readFileSync(new URL('../src/trash-settings-v2.tsx',import.meta.url),'utf8');
const dialog=readFileSync(new URL('../src/project-action-dialog-v2.tsx',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');

test('Settings places Trash directly before Terms while preserving Privacy and Logout',()=>{
 const a=settings.indexOf('>Trash <span');
 const b=settings.indexOf('href="/terms"');
 const c=settings.indexOf('href="/privacy"');
 const d=settings.indexOf('onece-account-logout');
 assert.ok(a>=0&&b>a&&c>b&&d>c);
 assert.match(settings,/trashOpen\?<TrashSettingsV2/);
});
test('Trash UI requires explicit confirmation and warns that R2 deletion is permanent',()=>{
 assert.match(panel,/confirmation:confirm/);
 assert.match(panel,/confirm!=='EMPTY TRASH'/);
 assert.match(panel,/unreferenced media/);
 assert.match(panel,/result\.done/);
 assert.match(panel,/pendingMedia/);
 assert.match(panel,/\/restore/);
 assert.match(panel,/notifyV2DataChanged/);
});
test('the prior Delete dialog now says Move to Trash instead of claiming irreversible deletion',()=>{
 assert.match(dialog,/Move this beat to Trash/);
 assert.match(dialog,/Move to Trash/);
 assert.match(dialog,/restore it in Settings/);
 assert.doesNotMatch(dialog,/Delete this beat permanently/);
});
test('Trash navigation remains within mounted workspace to preserve the player',()=>{
 assert.match(settings,/TrashSettingsV2/);
 assert.match(main,/element=\{<WorkspaceRoute\/>\}/);
 assert.doesNotMatch(main,/new Audio\(/);
});
