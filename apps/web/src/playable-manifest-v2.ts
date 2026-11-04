// Validate the playable API manifest, not just the TypeScript shape.
// Authorization for every byte-stream remains on the API.
import type {ProjectKindV2} from '../../../packages/shared/contracts.js';

export type PlayableTrackV2={
 id:string;owner_id:number;title:string;audio_file_id:number;
 cover_file_id:number|null;stems_file_id:null;
};
export type PlayableProjectV2={
 id:string;owner_id:number;kind:ProjectKindV2;title:string;
 cover_file_id:number|null;tracks:PlayableTrackV2[];
};
type ExpectedProjectV2={ownerId:number;kind:ProjectKindV2;id:string};
const record=(value:unknown):Record<string,unknown>|null=>
 value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const positiveId=(value:unknown):value is number=>
 typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
const uuid=(value:unknown):value is string=>
 typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const optionalFileId=(value:unknown):value is number|null=>
 value===null||positiveId(value);
const validTitle=(value:unknown):value is string=>
 typeof value==='string'&&value.trim().length>0;

export function parsePlayableProjectV2(payload:unknown,expected:ExpectedProjectV2):PlayableProjectV2{
 const root=record(payload),project=record(root?.project);
 if(!project||project.id!==expected.id||project.kind!==expected.kind||
    project.owner_id!==expected.ownerId||!validTitle(project.title)||
    !optionalFileId(project.cover_file_id)||!Array.isArray(project.tracks)){
  throw Error('Invalid project manifest');
 }
 const tracks:PlayableTrackV2[]=[];
 for(const candidate of project.tracks){
  const track=record(candidate);
  if(!track||!uuid(track.id)||track.owner_id!==expected.ownerId||
     !validTitle(track.title)||!positiveId(track.audio_file_id)||
     !optionalFileId(track.cover_file_id)){
   throw Error('Invalid project track');
  }
  tracks.push({
   id:track.id,owner_id:expected.ownerId,title:track.title,
   audio_file_id:track.audio_file_id,cover_file_id:track.cover_file_id,
   stems_file_id:null // Public playback/download never exposes stems.
  });
 }
 if(!tracks.length)throw Error('No playable tracks');
 return {id:expected.id,kind:expected.kind,owner_id:expected.ownerId,
  title:project.title,cover_file_id:project.cover_file_id,tracks};
}
