import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const read=p=>readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','src',p),'utf8');
const items=read('library-items-v2.tsx');

test('project opening reuses the owner-scoped opened-project cache before refetching',()=>{
 assert.match(items,/const cacheKey=openedTrackCacheKey\(pack\.owner_id\?\?userId\?\?0,'pack',pack\.id\);/);
 assert.match(items,/setOpenedTracks\(cached&&cached\.kind==='pack'\?cached\.tracks:\[\]\)/);
 assert.match(items,/if\(cached&&cached\.kind==='pack'\)\{[\s\S]{0,80}setPackLoading\(false\);/);
 assert.match(items,/openedTrackCache\.set\(cacheKey,\{kind:'pack',tracks,title:pack\.title,coverFileId:pack\.cover_file_id\}\)/);
 assert.match(items,/if\(!openRequest\|\|profileRouteKey===null\)return;/);
 assert.match(items,/const cacheKey=openedTrackCacheKey\(ownerId,kind,id\);/);
 assert.match(items,/if\(cached&&cached\.kind\)\{/);
});

test('account switch clears the opened-project cache and stale overlays',()=>{
 assert.match(items,/openedTrackCache\.clear\(\);[\s\S]{0,120}setOpenedPack\(null\);/);
});
