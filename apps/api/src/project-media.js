// Shared v2 authorization for existing media endpoints.
// Resolves an original R2 file once; publication and share grants are relationships,
// never duplicated files. No new HTTP routes are introduced here.
const mediaKinds=new Set(['audio','cover','stems']);

const fileSql=`SELECT f.object_key,f.content_type,f.byte_size
 FROM library_files f
 WHERE f.id=$1 AND f.user_id=$2 AND f.kind=$3 AND f.status='ready'
 LIMIT 1`;

// Non-owner media access is always tied to a real beat or pack referencing
// the requested file. A saved relationship by itself is not an access grant.
const authorizedProjectSql=`SELECT 1 FROM (
 SELECT 'beat'::text AS kind,b.id AS project_id
 FROM library_beats b
 WHERE b.user_id=$2 AND (
   ($3='audio' AND b.audio_file_id=$1) OR
   ($3='cover' AND b.cover_file_id=$1)
 )
 UNION ALL
 SELECT 'pack'::text AS kind,p.id AS project_id
 FROM library_packs p
 WHERE p.user_id=$2 AND $3='cover' AND p.cover_file_id=$1
) project
WHERE EXISTS (
 SELECT 1 FROM v2_public_projects pub
 WHERE pub.user_id=$2 AND pub.kind=project.kind AND pub.project_id=project.project_id
) OR (
 $4::integer IS NOT NULL AND EXISTS (
  SELECT 1 FROM v2_project_access access
  WHERE access.owner_id=$2 AND access.viewer_id=$4
   AND access.kind=project.kind AND access.project_id=project.project_id
 )
)
LIMIT 1`;

function validId(id){return Number.isSafeInteger(Number(id))&&Number(id)>0;}

/**
 * Resolve an original ready R2 object, enforcing a single media access policy.
 *
 * Owner: access to owned ready files, retaining current upload/Library behavior.
 * Published: cover/audio of a linked published project, including anonymous viewers.
 * Shared: cover/audio of a linked project for a viewer with an explicit grant.
 * Stems: owner-only until a separate stems-download policy is approved.
 *
 * Returns null for missing or unauthorized files. The caller should use the
 * same generic 404 response, avoiding exposure of private asset existence.
 *
 * @param {import('pg').Pool} pool
 * @param {{ownerId:number|string,viewerId?:number|string|null,fileId:number|string,kind:'audio'|'cover'|'stems'}} options
 */
export async function resolveAuthorizedMediaFile(pool,{ownerId,viewerId=null,fileId,kind}){
 if(!validId(ownerId)||!validId(fileId)||!mediaKinds.has(kind))return null;
 const owner=Number(ownerId);
 const viewer=validId(viewerId)?Number(viewerId):null;
 const fileResult=await pool.query(fileSql,[Number(fileId),owner,kind]);
 const file=fileResult.rows[0];
 if(!file)return null;

 // A stored upload may not have been attached to a project yet. Owner-only
 // access remains supported by existing Library/upload routes.
 if(viewer===owner)return file;
 if(kind==='stems')return null;

 const access=await pool.query(authorizedProjectSql,[Number(fileId),owner,kind,viewer]);
 return access.rowCount>0?file:null;
}
