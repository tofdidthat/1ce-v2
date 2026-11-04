// PostgreSQL-backed, atomic per-subject rolling windows. Shared by all API
// replicas; never use process-local maps as a security boundary.
import {createHash} from 'node:crypto';
import type {QueryableV2} from '../../../packages/shared/contracts.js';

export async function rateLimitExceeded(pool:QueryableV2,scope:string,subject:string|number,limit:number,windowMinutes:number):Promise<boolean>{
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
 initPerHour:240,
 completePerHour:360,
 pendingMinutes:30
});

export async function pruneExpiredRateLimits(pool:QueryableV2,{batchSize=500}:{batchSize?:number}={}):Promise<number>{
 if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>2000)
  throw new Error('Invalid rate-limit maintenance batch');
 const result=await pool.query(`WITH old AS (
   SELECT scope,subject_hash FROM v2_api_rate_limits
   WHERE window_started_at<now()-interval '7 days'
   ORDER BY window_started_at
   LIMIT $1
   FOR UPDATE SKIP LOCKED
  )
  DELETE FROM v2_api_rate_limits t USING old
   WHERE t.scope=old.scope AND t.subject_hash=old.subject_hash`,[batchSize]);
 return Number(result.rowCount||0);
}
