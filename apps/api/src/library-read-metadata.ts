// Private library metadata GET routes. The facade has already checked method,
// session and R2 configuration before calling this function. Do not move those
// security gates into the read module or expose these routes publicly.
import type {ServerResponse} from 'node:http';
import type {QueryableV2} from '../../../packages/shared/contracts.js';

type SendLibraryJson=(res:ServerResponse,status:number,data:unknown)=>void;

// A false result preserves the facade's existing generic 404 fallback.
export async function handlePrivateLibraryMetadataRead(
 res:ServerResponse,segments:readonly string[],pool:QueryableV2,
 ownerId:number,send:SendLibraryJson
):Promise<boolean>{
 // Owner-only metadata for a single original beat; never expose stems to public viewers.
 if(segments.length===5&&segments[3]==='beat'&&/^[0-9a-f-]{36}$/i.test(segments[4])){
  const q=await pool.query(`SELECT b.id,b.title,b.audio_file_id,b.stems_file_id
   FROM library_beats b JOIN library_files audio ON audio.id=b.audio_file_id
    AND audio.user_id=b.user_id AND audio.kind='audio' AND audio.status='ready'
   WHERE b.id=$1 AND b.user_id=$2 AND b.deleted_at IS NULL LIMIT 1`,[segments[4],ownerId]);
  if(!q.rowCount){send(res,404,{error:'Beat not found'});return true;}
  send(res,200,{beat:q.rows[0]});return true;
 }
 if(segments.length===5&&segments[3]==='pack-tracks'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(segments[4])){
  // A live, owner-authorized pack must yield one row even with zero playable
  // tracks. Missing, deleted and other-owner packs yield no rows (same 404).
  // This single PostgreSQL snapshot avoids a check-then-read ownership race.
  const q=await pool.query(`SELECT p.id AS pack_id,
    tracks.id,tracks.title,tracks.audio_file_id,tracks.cover_file_id,tracks.stems_file_id
   FROM library_packs p
   LEFT JOIN LATERAL (
    SELECT b.id,b.title,b.audio_file_id,
      cover.id AS cover_file_id,stems.id AS stems_file_id,pb.position
    FROM library_pack_beats pb
    JOIN library_beats b ON b.id=pb.beat_id AND b.user_id=p.user_id AND b.deleted_at IS NULL
    JOIN library_files audio ON audio.id=b.audio_file_id
      AND audio.user_id=p.user_id AND audio.kind='audio' AND audio.status='ready'
    LEFT JOIN library_files cover ON cover.id=b.cover_file_id
      AND cover.user_id=p.user_id AND cover.kind='cover' AND cover.status='ready'
    LEFT JOIN library_files stems ON stems.id=b.stems_file_id
      AND stems.user_id=p.user_id AND stems.kind='stems' AND stems.status='ready'
    WHERE pb.pack_id=p.id
   ) tracks ON true
   WHERE p.id=$1 AND p.user_id=$2 AND p.deleted_at IS NULL
   ORDER BY tracks.position ASC`,[segments[4],ownerId]);
  if(!q.rows.length){send(res,404,{error:'Pack not found'});return true;}
  const beats=q.rows.filter(row=>row.id!=null).map(row=>({
   id:row.id,title:row.title,audio_file_id:row.audio_file_id,
   cover_file_id:row.cover_file_id,stems_file_id:row.stems_file_id
  }));
  send(res,200,{beats});return true;
 }
 if(segments.length===4&&segments[3]==='items'){
  const [beats,packs]=await Promise.all([
   pool.query(`SELECT b.id,b.title,b.created_at,b.audio_file_id,b.cover_file_id,b.stems_file_id,b.library_visible,
     a.original_name AS audio_name,a.byte_size AS audio_size,
     (SELECT count(*)::int FROM library_pack_beats pb JOIN library_packs p2 ON p2.id=pb.pack_id AND p2.deleted_at IS NULL WHERE pb.beat_id=b.id) AS pack_count
     FROM library_beats b JOIN library_files a ON a.id=b.audio_file_id AND a.status='ready'
     WHERE b.user_id=$1 AND b.deleted_at IS NULL ORDER BY b.created_at DESC LIMIT 200`,[ownerId]),
   pool.query(`SELECT p.id,p.title,p.created_at,p.cover_file_id,
     COUNT(bactive.id)::int AS track_count
     FROM library_packs p LEFT JOIN library_pack_beats pb ON pb.pack_id=p.id LEFT JOIN library_beats bactive ON bactive.id=pb.beat_id AND bactive.deleted_at IS NULL
     WHERE p.user_id=$1 AND p.deleted_at IS NULL GROUP BY p.id ORDER BY p.created_at DESC LIMIT 100`,[ownerId])
  ]);
  send(res,200,{beats:beats.rows,packs:packs.rows});return true;
 }
 if(segments.length===3){
  const q=await pool.query("SELECT id,kind,original_name,content_type,byte_size,created_at FROM library_files WHERE user_id=$1 AND status='ready' ORDER BY created_at DESC LIMIT 100",[ownerId]);
  send(res,200,{files:q.rows});return true;
 }
 return false;
}
