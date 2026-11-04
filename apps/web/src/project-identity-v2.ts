// Canonical 1CE v2 project identity and viewer-flag normalization.
// Pure functions: safe to test without browser, React or network dependencies.
import type {ProjectKindV2,ProjectIdentityV2} from '../../../packages/shared/contracts.js';
export type {ProjectKindV2,ProjectIdentityV2} from '../../../packages/shared/contracts.js';
export type ViewerProjectFlagsV2={
 viewerId:number;
 saved:ReadonlySet<string>;
 published:ReadonlySet<string>;
};
export const savedProjectKeyV2=(ownerId:number,kind:ProjectKindV2,id:string)=>ownerId+':'+kind+':'+id;
export const publishedProjectKeyV2=(kind:ProjectKindV2,id:string)=>kind+':'+id;
const isKind=(value:unknown):value is ProjectKindV2=>value==='beat'||value==='pack';
const isId=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
const isOwner=(value:unknown):value is number=>Number.isSafeInteger(Number(value))&&Number(value)>0;

// Invalid or partial metadata cannot create a positive saved/published UI flag.
// Only the server may authorize the actual project or its media.
export function normalizeViewerProjectFlagsV2(viewerId:number,payload:unknown):ViewerProjectFlagsV2{
 const raw=payload&&typeof payload==='object'?payload as Record<string,unknown>:{};
 const saved=new Set<string>();
 const published=new Set<string>();
 if(Array.isArray(raw.saved))for(const item of raw.saved){
  if(!item||typeof item!=='object')continue;
  const entry=item as Record<string,unknown>;
  if(isOwner(entry.owner_id)&&isKind(entry.kind)&&isId(entry.id)){
   saved.add(savedProjectKeyV2(Number(entry.owner_id),entry.kind,entry.id));
  }
 }
 if(Array.isArray(raw.published))for(const item of raw.published){
  if(!item||typeof item!=='object')continue;
  const entry=item as Record<string,unknown>;
  if(isKind(entry.kind)&&isId(entry.id)){
   published.add(publishedProjectKeyV2(entry.kind,entry.id));
  }
 }
 return {viewerId,saved,published};
}
