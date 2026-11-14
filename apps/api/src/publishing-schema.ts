import {readFile} from 'node:fs/promises';
import type {QueryableV2} from '../../../packages/shared/contracts.js';
const ready=new WeakMap<QueryableV2,Promise<void>>();
export function ensurePublishingSchema(db:QueryableV2):Promise<void>{
 let pending=ready.get(db);
 if(!pending){
  pending=(async()=>{
   // Paths work for both src and compiled dist in the existing monorepo image.
   for(const name of ['016_publication_queue.sql','017_youtube_publishing.sql']){
    const sql=await readFile(new URL('../../../history/database/'+name,import.meta.url),'utf8');
    await db.query(sql);
   }
  })().catch(error=>{ready.delete(db);throw error});ready.set(db,pending);
 }
 return pending;
}
