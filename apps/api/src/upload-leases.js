// Cross-replica short-lived completion lease. Never hold a PostgreSQL pool
// connection open while copying/hashing a file in R2. Every READY promotion
// must be fenced by the exact lease token issued to that request.
import {randomUUID} from 'node:crypto';

export const COMPLETION_LEASE_MINUTES=10;

export async function acquireCompletionLease(pool,fileId,ownerId){
 const token=randomUUID();
 const result=await pool.query(`INSERT INTO v2_upload_completion_leases(file_id,lease_token,expires_at)
  SELECT id,$2::uuid,now()+interval '10 minutes'
  FROM library_files
  WHERE id=$1 AND user_id=$3 AND status='pending'
   AND created_at>now()-interval '30 minutes'
  ON CONFLICT(file_id) DO UPDATE SET
   lease_token=EXCLUDED.lease_token,
   expires_at=EXCLUDED.expires_at
  WHERE v2_upload_completion_leases.expires_at<now()
  RETURNING lease_token`,[fileId,token,ownerId]);
 return result.rowCount===1?token:null;
}

export async function releaseCompletionLease(pool,fileId,token){
 await pool.query(
  'DELETE FROM v2_upload_completion_leases WHERE file_id=$1 AND lease_token=$2::uuid',
  [fileId,token]
 );
}

// Every terminal transition locks its lease row before changing file metadata.
// A worker whose lease expired or was replaced must not fail, discard or
// promote the newer owner's upload. No DB lock is held during R2 I/O.
// Call with the exact same final key that was server-copied and verified.
// Expired/stolen lease holders cannot transition metadata to READY.
export async function promoteReadyWithLease(pool,{fileId,ownerId,finalKey,token}){
 return pool.query(`WITH active_lease AS MATERIALIZED (
   SELECT file_id FROM v2_upload_completion_leases
   WHERE file_id=$1 AND lease_token=$4::uuid AND expires_at>clock_timestamp()
   FOR UPDATE
  )
  UPDATE library_files SET object_key=$3,status='ready',updated_at=now()
  WHERE id=$1 AND user_id=$2 AND status='pending'
   AND id IN (SELECT file_id FROM active_lease)`,
  [fileId,ownerId,finalKey,token]);
}

export async function failPendingWithLease(pool,{fileId,ownerId,token}){
 return pool.query(`WITH active_lease AS MATERIALIZED (
   SELECT file_id FROM v2_upload_completion_leases
   WHERE file_id=$1 AND lease_token=$3::uuid AND expires_at>clock_timestamp()
   FOR UPDATE
  )
  UPDATE library_files SET status='failed',updated_at=now()
  WHERE id=$1 AND user_id=$2 AND status='pending'
   AND id IN (SELECT file_id FROM active_lease)`,
  [fileId,ownerId,token]);
}

// Duplicate READY asset exists: a stale request must not delete a pending
// upload currently owned by a different finalizer. ON DELETE CASCADE removes
// only the lease associated with the row we successfully discarded.
export async function discardPendingWithLease(pool,{fileId,ownerId,token}){
 return pool.query(`WITH active_lease AS MATERIALIZED (
   SELECT file_id FROM v2_upload_completion_leases
   WHERE file_id=$1 AND lease_token=$3::uuid AND expires_at>clock_timestamp()
   FOR UPDATE
  )
  DELETE FROM library_files
  WHERE id=$1 AND user_id=$2 AND status='pending'
   AND id IN (SELECT file_id FROM active_lease)`,
  [fileId,ownerId,token]);
}
