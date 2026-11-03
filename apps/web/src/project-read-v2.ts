// Pure, typed read adapters for the existing 1CE v2 Library and Profile APIs.
// These project references never authorize media or copy underlying assets.
import type {ProjectIdentityV2,ProjectKindV2} from './project-identity-v2';

export type LibraryBeatV2=ProjectIdentityV2 & {
 id:string;owner_id:number;title:string;audio_file_id:number;cover_file_id:number|null;
 stems_file_id:number|null;pack_count:number;created_at:string;library_visible:boolean;
};
export type LibraryPackV2=ProjectIdentityV2 & {
 id:string;owner_id:number;title:string;cover_file_id:number|null;track_count:number;created_at:string;
};
export type LibraryProjectsV2={beats:LibraryBeatV2[];packs:LibraryPackV2[]};
export type ProfileProjectV2=ProjectIdentityV2 & {
 id:string;kind:ProjectKindV2;owner_id:number;title:string;
 cover_file_id:number|null;track_count:number|null;published_at:string;
};
export type ProfileProjectsV2={catalog:ProfileProjectV2[];saves:ProfileProjectV2[]};

const rows=(value:unknown):unknown[]=>Array.isArray(value)?value:[];
const record=(value:unknown):Record<string,unknown>|null=>
 value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const positiveInteger=(value:unknown):number|null=>{
 // PostgreSQL integer fields are numbers; accept numeric strings for driver compatibility.
 if(typeof value!=='number'&&typeof value!=='string')return null;
 if(typeof value==='string'&&!/^\d+$/.test(value))return null;
 const n=Number(value);
 return Number.isSafeInteger(n)&&n>0?n:null;
};
const zeroOrPositiveInteger=(value:unknown)=>value===0?0:positiveInteger(value)??0;
const nonEmptyString=(value:unknown)=>typeof value==='string'&&value.length>0?value:null;
const nullableFileId=(value:unknown)=>positiveInteger(value);
const dateString=(value:unknown)=>typeof value==='string'?value:'';
const titleString=(value:unknown)=>typeof value==='string'&&value.trim()?value:'Untitled';

export function normalizeLibraryProjectsV2(payload:unknown,viewerId:number):LibraryProjectsV2{
 const raw=record(payload)||{};
 const owner=positiveInteger(viewerId);
 if(!owner)return {beats:[],packs:[]};
 const beats:LibraryBeatV2[]=[];
 for(const value of rows(raw.beats)){
  const row=record(value);
  if(!row)continue;
  const id=nonEmptyString(row.id),audioFileId=positiveInteger(row.audio_file_id);
  if(!id||!audioFileId)continue;
  beats.push({
   ownerId:owner,kind:'beat',projectId:id,id,owner_id:owner,
   title:titleString(row.title),audio_file_id:audioFileId,
   cover_file_id:nullableFileId(row.cover_file_id),
   stems_file_id:nullableFileId(row.stems_file_id),
   pack_count:zeroOrPositiveInteger(row.pack_count),
   created_at:dateString(row.created_at),
   library_visible:row.library_visible!==false
  });
 }
 const packs:LibraryPackV2[]=[];
 for(const value of rows(raw.packs)){
  const row=record(value);
  if(!row)continue;
  const id=nonEmptyString(row.id);
  if(!id)continue;
  packs.push({
   ownerId:owner,kind:'pack',projectId:id,id,owner_id:owner,
   title:titleString(row.title),cover_file_id:nullableFileId(row.cover_file_id),
   track_count:zeroOrPositiveInteger(row.track_count),created_at:dateString(row.created_at)
  });
 }
 return {beats,packs};
}

export function normalizeProfileProjectsV2(payload:unknown):ProfileProjectsV2{
 const raw=record(payload)||{};
 const normalize=(value:unknown):ProfileProjectV2|null=>{
  const row=record(value);
  if(!row)return null;
  const id=nonEmptyString(row.id),owner=positiveInteger(row.owner_id);
  const kind=row.kind;
  if(!id||!owner||(kind!=='beat'&&kind!=='pack'))return null;
  return {
   ownerId:owner,kind,projectId:id,id,owner_id:owner,title:titleString(row.title),
   cover_file_id:nullableFileId(row.cover_file_id),
   track_count:kind==='pack'?zeroOrPositiveInteger(row.track_count):null,
   published_at:dateString(row.published_at)
  };
 };
 return {catalog:rows(raw.catalog).map(normalize).filter((row):row is ProfileProjectV2=>row!==null),
  saves:rows(raw.saves).map(normalize).filter((row):row is ProfileProjectV2=>row!==null)};
}

// Do not sort: backend already orders pack member IDs by library_pack_beats.position.
// A pack's cover may fill a missing beat cover without creating a second asset.
export function normalizePackTracksV2(payload:unknown,pack:Pick<LibraryPackV2,'cover_file_id'|'owner_id'>):LibraryBeatV2[]{
 return normalizeLibraryProjectsV2({beats:record(payload)?.beats},pack.owner_id).beats.map(beat=>({
  ...beat,cover_file_id:beat.cover_file_id??pack.cover_file_id
 }));
}

export const sameProjectV2=(left:ProjectIdentityV2,right:ProjectIdentityV2)=>
 left.ownerId===right.ownerId&&left.kind===right.kind&&left.projectId===right.projectId;
