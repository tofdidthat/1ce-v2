import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {QueryableV2} from '../../../packages/shared/contracts.js';
const ready=new WeakMap<QueryableV2,Promise<void>>();
export function ensurePublishingSchema(db:QueryableV2):Promise<void>{
 let pending=ready.get(db);
 if(!pending){
  pending=(async()=>{
   // Paths work for both src and compiled dist in the existing monorepo image.
   for(const name of ['016_publication_queue.sql','017_youtube_publishing.sql','018_instagram_connections.sql','019_instagram_reels.sql',
    '020_instagram_meta_compliance.sql','021_instagram_data_deletion.sql','022_tiktok_connections.sql']){
    const sql=await readFile(new URL('../../../history/database/'+name,import.meta.url),'utf8');
    await db.query(sql);
   }
   const connected=(await db.query('SELECT user_id,instagram_user_id FROM v2_instagram_connections')).rows;
   for(const row of connected){
    const instagramUserId=String(row.instagram_user_id),userId=Number(row.user_id);
    if(!Number.isSafeInteger(userId)||userId<1||!/^[0-9]{1,32}$/.test(instagramUserId))continue;
    const identityHash=createHash('sha256').update('instagram-meta-subject:'+instagramUserId).digest('hex');
    // The scan can outlive a completed deletion. Revalidate and lock the live
    // connection in the insert itself, so a stale scan cannot restore its link.
    await db.query(`INSERT INTO v2_instagram_compliance_subjects(user_id,instagram_user_id_hash)
     SELECT user_id,$2 FROM (SELECT user_id FROM v2_instagram_connections
      WHERE user_id=$1 AND instagram_user_id=$3 FOR SHARE) live
     ON CONFLICT(user_id,instagram_user_id_hash) DO NOTHING`,[userId,identityHash,instagramUserId]);
   }
  })().catch(error=>{ready.delete(db);throw error});ready.set(db,pending);
 }
 return pending;
}
