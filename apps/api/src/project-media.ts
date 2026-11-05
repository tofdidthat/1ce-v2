// Shared v2 authorization for existing media endpoints.
// Resolves an original R2 file once; publication and share grants are relationships,
// never duplicated files. No new HTTP routes are introduced here.
import type {MediaKindV2,ProjectKindV2,QueryableV2} from '../../../packages/shared/contracts.js';

type OwnedReadyMediaV2={
 object_key:string;
 content_type:string;
 byte_size:number|string;
};
type MediaAccessInputV2={
 ownerId:number|string;
 viewerId?:number|string|null;
 fileId:number|string;
 kind:MediaKindV2;
};
type PlayableProjectInputV2={
 ownerId:number|string;
 viewerId?:number|string|null;
 kind:ProjectKindV2;
 projectId:string;
};
type PlayableDbRowV2={
 id:string;
 title:string;
 owner_id:number;
 audio_file_id:number;
 cover_file_id:number|null;
 stems_file_id:number|null;
};
// Pack rows do not have audio or stems file IDs. Those belong to member beats.
type PlayablePackRowV2=Pick<PlayableDbRowV2,'id'|'title'|'owner_id'|'cover_file_id'>;
type PlayableManifestV2={
 owner_id:number;
 kind:ProjectKindV2;
 id:string;
 title:string;
 cover_file_id:number|null;
 tracks:PlayableDbRowV2[];
};
const mediaKinds=new Set<MediaKindV2>(['audio','cover','stems']);

const positiveFileId=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const optionalFileId=(v:unknown):v is number|null=>v===null||positiveFileId(v);
const dbRecord=(value:unknown):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid database media row');
 return value as Record<string,unknown>;
};
function decodeReadyMediaRow(value:unknown):OwnedReadyMediaV2{
 const row=dbRecord(value);
 const bytes=row.byte_size;
 const validSize=(typeof bytes==='number'&&Number.isSafeInteger(bytes)&&bytes>0)||
  (typeof bytes==='string'&&/^[1-9]\d*$/.test(bytes));
 if(typeof row.object_key!=='string'||!row.object_key||
  typeof row.content_type!=='string'||!row.content_type||!validSize)
  throw Error('Invalid ready media metadata');
 return {object_key:row.object_key,content_type:row.content_type,byte_size:bytes as number|string};
}

const fileSql=`SELECT f.object_key,f.content_type,f.byte_size
 FROM library_files f
 WHERE f.id=$1 AND f.user_id=$2 AND f.kind=$3 AND f.status='ready'
 LIMIT 1`;

// Non-owner media access is tied to an original beat/pack referencing the
// file. Saves are durable *personal* audio/cover entitlements created only
// with permission at Save time; they never publish a project, grant stems,
// grant access to unrelated files, or expose private Saves to third parties.
const authorizedProjectSql=`SELECT 1 FROM (
 SELECT 'beat'::text AS kind,b.id AS project_id
 FROM library_beats b
 WHERE b.user_id=$2 AND b.deleted_at IS NULL AND (
   ($3='audio' AND b.audio_file_id=$1) OR
   ($3='cover' AND b.cover_file_id=$1)
 )
 UNION ALL
 SELECT 'pack'::text AS kind,p.id AS project_id
 FROM library_packs p
 WHERE p.user_id=$2 AND p.deleted_at IS NULL AND $3='cover' AND p.cover_file_id=$1
 UNION ALL
 -- A published/shared pack grants access to the audio and cover of its
 -- original member beats without publishing those beats individually.
 SELECT 'pack'::text AS kind,p.id AS project_id
 FROM library_packs p
 JOIN library_pack_beats pb ON pb.pack_id=p.id
 JOIN library_beats member ON member.id=pb.beat_id AND member.user_id=p.user_id
 WHERE p.user_id=$2 AND p.deleted_at IS NULL AND member.deleted_at IS NULL AND (
  ($3='audio' AND member.audio_file_id=$1) OR
  ($3='cover' AND member.cover_file_id=$1)
 )
) project
WHERE EXISTS (
 SELECT 1 FROM v2_public_projects pub
 WHERE pub.user_id=$2 AND pub.kind=project.kind AND pub.project_id=project.project_id
) OR (
 $4::integer IS NOT NULL AND EXISTS (
  SELECT 1 FROM v2_project_access grant_access
  WHERE grant_access.owner_id=$2 AND grant_access.viewer_id=$4
   AND grant_access.kind=project.kind AND grant_access.project_id=project.project_id
 ) OR EXISTS (
  SELECT 1 FROM v2_public_saves saved
  WHERE saved.owner_id=$2 AND saved.user_id=$4
   AND saved.kind=project.kind AND saved.project_id=project.project_id
 )
)
LIMIT 1`;

function validId(id:unknown):id is number|string{
 if(typeof id==='number')return Number.isSafeInteger(id)&&id>0;
 return typeof id==='string'&&/^[1-9]\d*$/.test(id)&&Number.isSafeInteger(Number(id));
}

/**
 * Resolve an original ready R2 object, enforcing a single media access policy.
 *
 * Owner: access to owned ready files, retaining current upload/Library behavior.
 * Published: cover/audio of a linked published project, including anonymous viewers.
 * Shared: cover/audio of a linked project for a viewer with an explicit grant.
 * Saved: cover/audio for the original saver, including after Unpublish.
 * Stems: owner-only until a separate stems-download policy is approved.
 *
 * Returns null for missing or unauthorized files. The caller should use the
 * same generic 404 response, avoiding exposure of private asset existence.
 *
 * @param {import('pg').Pool} pool
 * @param {{ownerId:number|string,viewerId?:number|string|null,fileId:number|string,kind:'audio'|'cover'|'stems'}} options
 */
export async function resolveAuthorizedMediaFile(pool:QueryableV2,{ownerId,viewerId=null,fileId,kind}:MediaAccessInputV2):Promise<OwnedReadyMediaV2|null>{
 if(!validId(ownerId)||!validId(fileId)||!mediaKinds.has(kind))return null;
 const owner=Number(ownerId);
 const viewer=validId(viewerId)?Number(viewerId):null;
 const fileResult=await pool.query(fileSql,[Number(fileId),owner,kind]);
 const rawFile=fileResult.rows[0];
 if(!rawFile)return null;
 const file=decodeReadyMediaRow(rawFile);

 // A stored upload may not have been attached to a project yet. Owner-only
 // access remains supported by existing Library/upload routes.
 if(viewer===owner)return file;
 if(kind==='stems')return null;

 const access=await pool.query(authorizedProjectSql,[Number(fileId),owner,kind,viewer]);
 return (access.rowCount??0)>0?file:null;
}


// A playable manifest refers to original project IDs and existing private
// file IDs. It never creates media, grants access, or exposes R2 object keys.
const projectUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function decodePlayablePackRow(value:unknown,owner:number):PlayablePackRowV2{
 const row=dbRecord(value);
 if(typeof row.id!=='string'||!projectUuid.test(row.id)||
  typeof row.title!=='string'||row.owner_id!==owner||
  !optionalFileId(row.cover_file_id))
  throw Error('Invalid database pack metadata');
 return {id:row.id,title:row.title,owner_id:owner,cover_file_id:row.cover_file_id};
}
function decodePlayableBeatRow(value:unknown,owner:number):PlayableDbRowV2{
 const row=dbRecord(value);
 if(typeof row.id!=='string'||!projectUuid.test(row.id)||
  typeof row.title!=='string'||row.owner_id!==owner||
  !positiveFileId(row.audio_file_id)||!optionalFileId(row.cover_file_id)||
  !optionalFileId(row.stems_file_id))
  throw Error('Invalid database beat metadata');
 return {id:row.id,title:row.title,owner_id:owner,
  audio_file_id:row.audio_file_id,cover_file_id:row.cover_file_id,
  stems_file_id:row.stems_file_id};
}
const projectPermission=(alias:string,kind:ProjectKindV2)=>`
  ( ${alias}.user_id=$3::integer
    OR EXISTS(SELECT 1 FROM v2_public_projects pub
       WHERE pub.user_id=${alias}.user_id AND pub.kind='${kind}' AND pub.project_id=${alias}.id)
    OR ($3::integer IS NOT NULL AND EXISTS(SELECT 1 FROM v2_project_access grant_access
       WHERE grant_access.owner_id=${alias}.user_id AND grant_access.viewer_id=$3
         AND grant_access.kind='${kind}' AND grant_access.project_id=${alias}.id))
    OR ($3::integer IS NOT NULL AND EXISTS(SELECT 1 FROM v2_public_saves saved
       WHERE saved.owner_id=${alias}.user_id AND saved.user_id=$3
         AND saved.kind='${kind}' AND saved.project_id=${alias}.id))
  )`;

const playableBeatSql=`SELECT b.id,b.title,b.user_id AS owner_id,b.audio_file_id,b.cover_file_id,
 CASE WHEN b.user_id=$3::integer THEN b.stems_file_id ELSE NULL END AS stems_file_id
 FROM library_beats b
 JOIN library_files file ON file.id=b.audio_file_id AND file.user_id=b.user_id AND file.kind='audio' AND file.status='ready'
 WHERE b.user_id=$1 AND b.id=$2 AND b.deleted_at IS NULL AND ${projectPermission('b','beat')}
 LIMIT 1`;

const playablePackSql=`SELECT p.id,p.title,p.user_id AS owner_id,p.cover_file_id
 FROM library_packs p
 WHERE p.user_id=$1 AND p.id=$2 AND p.deleted_at IS NULL AND ${projectPermission('p','pack')}
 LIMIT 1`;

const playablePackMembersSql=`SELECT b.id,b.title,b.user_id AS owner_id,b.audio_file_id,b.cover_file_id,
 CASE WHEN b.user_id=$3::integer THEN b.stems_file_id ELSE NULL END AS stems_file_id
 FROM library_pack_beats pb
 JOIN library_beats b ON b.id=pb.beat_id AND b.user_id=$2
 JOIN library_files file ON file.id=b.audio_file_id AND file.user_id=b.user_id AND file.kind='audio' AND file.status='ready'
 WHERE pb.pack_id=$1 AND b.deleted_at IS NULL ORDER BY pb.position ASC`;

/**
 * Resolve a beat or pack for playback by canonical (ownerId, kind, projectId).
 * Private projects require ownership, an explicit share grant, or a personal
 * saved reference. Published projects remain playable to anonymous visitors.
 * A saver's private Saves listing is never exposed to another viewer.
 *
 * This check is repeated for each byte-stream request by resolveAuthorizedMediaFile,
 * so revoking access prevents subsequent reads even with a known file ID.
 */
export async function resolvePlayableProject(pool:QueryableV2,{ownerId,viewerId=null,kind,projectId}:PlayableProjectInputV2):Promise<PlayableManifestV2|null>{
 if(!validId(ownerId)||!['beat','pack'].includes(kind)||typeof projectId!=='string'||!projectUuid.test(projectId))return null;
 const owner=Number(ownerId);
 const viewer=validId(viewerId)?Number(viewerId):null;
 const query=kind==='beat'?playableBeatSql:playablePackSql;
 const result=await pool.query(query,[owner,projectId,viewer]);
 const rawProject=result.rows[0];
 if(!rawProject)return null;
 const project=kind==='beat'?decodePlayableBeatRow(rawProject,owner):decodePlayablePackRow(rawProject,owner);
 const tracks:PlayableDbRowV2[]=kind==='beat'
  ?[decodePlayableBeatRow(rawProject,owner)]
  :(await pool.query(playablePackMembersSql,[projectId,owner,viewer])).rows.map(row=>decodePlayableBeatRow(row,owner));
 return {owner_id:owner,kind,id:project.id,title:project.title,cover_file_id:project.cover_file_id,
  tracks};
}
