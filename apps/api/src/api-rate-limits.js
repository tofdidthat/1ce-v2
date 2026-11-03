// PostgreSQL-backed, atomic per-subject rolling windows. Shared by all API
// replicas; never use process-local maps as a security boundary.
import {createHash} from 'node:crypto';

export async function rateLimitExceeded(pool,scope,subject,limit,windowMinutes){
 if(!/^[a-z][a-z0-9-]{0,39}$/.test(scope)||
  !Number.isSafeInteger(limit)||limit<1||
  !Number.isSafeInteger(windowMinutes)||windowMinutes<1||windowMinutes>1440)
  throw new Error('Invalid rate-limit configuration');
 const subjectHash=createHash('sha256').update(String(subject)).digest('hex');
 const result=await pool.query(`INSERT INTO v2_api_rate_limits(scope,subject_hash,window_started_at,hits)
  VALUES($1,$2,now(),1)
  ON CONFLICT (scope,subject_hash) DO UPDATE SET
   hits=CASE WHEN v2_api_rate_limits.window_started_at < now()-($3::int * interval '1 minute')
    THEN 1 ELSE v2_api_rate_limits.hits+1 END,
   window_started_at=CASE WHEN v2_api_rate_limits.window_started_at < now()-($3::int * interval '1 minute')
    THEN now() ELSE v2_api_rate_limits.window_started_at END
  RETURNING hits`,[scope,subjectHash,windowMinutes]);
 return Number(result.rows[0]?.hits)>limit;
}

export const uploadLimits=Object.freeze({
 maxPending:10,
 maxStoredBytes:10*1024*1024*1024, // 10 GiB per account; includes recent pending reservations
 initPerHour:240,
 completePerHour:360,
 pendingMinutes:30
});
