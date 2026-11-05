// A single, source-backed playback queue for Home, Catalog and Saves.
// Only the API grants access. Queueing never duplicates R2 media.
import {normalizeLibraryProjectsV2,type LibraryBeatV2} from './project-read-v2.ts';
import type {PlayableProjectV2} from './playable-manifest-v2';

export type PlaybackQueueTrackV2=LibraryBeatV2&{queue_pack_id?:string|null};
type QueueIdentity=Pick<LibraryBeatV2,'owner_id'|'id'>;
export const queueTrackKeyV2=(track:QueueIdentity)=>track.owner_id+':'+track.id;

export function appendDistinctQueueV2<T extends QueueIdentity>(current:readonly T[],incoming:readonly T[]):T[]{
 const ids=new Set<string>();
 const result:T[]=[];
 for(const item of [...current,...incoming]){
  const key=queueTrackKeyV2(item);
  if(ids.has(key))continue;
  ids.add(key);
  result.push(item);
 }
 return result;
}

export function upcomingQueueV2<T extends QueueIdentity>(queue:readonly T[],now:QueueIdentity|null):T[]{
 if(!now)return [...queue];
 const at=queue.findIndex(track=>queueTrackKeyV2(track)===queueTrackKeyV2(now));
 if(at===-1)return queue.filter(track=>queueTrackKeyV2(track)!==queueTrackKeyV2(now));
 return queue.slice(at+1);
}

export function tracksFromPlayableProjectV2(project:PlayableProjectV2):PlaybackQueueTrackV2[]{
 const beats=normalizeLibraryProjectsV2({beats:project.tracks},project.owner_id).beats;
 if(!beats.length||beats.length!==project.tracks.length)throw Error('Invalid playable project tracks');
 return beats.map(beat=>({...beat,cover_file_id:beat.cover_file_id??project.cover_file_id}));
}
