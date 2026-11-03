// PR #27 additive migration gate. Only executes against an ephemeral localhost
// PostgreSQL database named onece_s2_ci. Never connect this script to production.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import pg from 'pg';
import {rateLimitExceeded,pruneExpiredRateLimits} from '../src/api-rate-limits.js';
import {accountStorageQuota,GIB} from '../src/storage-plans.js';

const connectionString=process.env.S2_TEST_DATABASE_URL;
if(!connectionString)throw new Error('S2_TEST_DATABASE_URL is required');
const u=new URL(connectionString);
if(!['postgres:','postgresql:'].includes(u.protocol)||
 !['localhost','127.0.0.1','::1','[::1]'].includes(u.hostname)||
 u.pathname!=='/onece_s2_ci')throw new Error('S2 smoke only runs against local onece_s2_ci');
const dir=resolve(dirname(fileURLToPath(import.meta.url)),'../../../history/database');
const migration=async name=>readFile(resolve(dir,name),'utf8');
const authSql=await migration('001_auth_initial_schema.sql');
const fileSql=await migration('003_library_files_r2.sql');
const sql=await migration('010_api_rate_limits.sql');
const plansSql=await migration('011_storage_plans_completion_leases.sql');
const pool=new pg.Pool({connectionString,max:8,connectionTimeoutMillis:5000});
try{
 // Base schema is created ONLY in this disposable local PostgreSQL database.
 await pool.query(authSql);
 await pool.query(fileSql);
 // Reapplying both additive S2 migrations must be harmless.
 await pool.query(sql);
 await pool.query(sql);
 await pool.query(plansSql);
 await pool.query(plansSql);
 const table=await pool.query("SELECT to_regclass('public.v2_api_rate_limits')::text AS name");
 if(table.rows[0]?.name!=='v2_api_rate_limits')throw Error('Throttle table missing');
 const index=await pool.query("SELECT to_regclass('public.v2_api_rate_limits_window_idx')::text AS name");
 if(index.rows[0]?.name!=='v2_api_rate_limits_window_idx')throw Error('Throttle index missing');
 const concurrent=await Promise.all(Array.from({length:30},()=>rateLimitExceeded(pool,'s2-smoke','demo@example.test',20,15)));
 if(concurrent.filter(Boolean).length!==10)throw Error('Non-atomic shared limiter: '+JSON.stringify(concurrent));
 const query=await pool.query("SELECT subject_hash,hits FROM v2_api_rate_limits WHERE scope='s2-smoke'");
 if(query.rows.length!==1||query.rows[0].hits!==30||
  query.rows[0].subject_hash.includes('@'))throw Error('Hashed subject or counter mismatch');
 await pool.query("UPDATE v2_api_rate_limits SET window_started_at=now()-interval '16 minutes' WHERE scope='s2-smoke'");
 if(await rateLimitExceeded(pool,'s2-smoke','demo@example.test',20,15))throw Error('Expired window not reset');
 const reset=await pool.query("SELECT hits FROM v2_api_rate_limits WHERE scope='s2-smoke'");
 if(reset.rows[0].hits!==1)throw Error('Unexpected reset count');
 const account=await pool.query("INSERT INTO account_users(email) VALUES('s2-plan-demo@example.test') RETURNING id");
 const id=account.rows[0].id;
 if(await accountStorageQuota(pool,id)!==10*GIB)throw Error('Default 10GiB plan missing');
 await pool.query("INSERT INTO v2_storage_plans(code,storage_limit_bytes) VALUES('ci_custom', $1)",[40*GIB]);
 await pool.query("INSERT INTO v2_account_storage_plans(user_id,plan_code) VALUES($1,'ci_custom')",[id]);
 if(await accountStorageQuota(pool,id)!==40*GIB)throw Error('Assigned plan not enforced');
 const other=await pool.query("INSERT INTO account_users(email) VALUES('s2-other@example.test') RETURNING id");
 if(await accountStorageQuota(pool,other.rows[0].id)!==10*GIB)
  throw Error('Unassigned account leaked another plan');
 const asset=await pool.query(`INSERT INTO library_files(user_id,kind,object_key,original_name,content_type,byte_size,status)
  VALUES($1,'audio','ci/object','ci.mp3','audio/mpeg',64,'pending') RETURNING id`,[id]);
 const fileId=asset.rows[0].id;
 const tokenA='11111111-1111-4111-8111-111111111111';
 const tokenB='22222222-2222-4222-8222-222222222222';
 const leaseQuery=`INSERT INTO v2_upload_completion_leases(file_id,lease_token,expires_at)
 VALUES($1,$2::uuid,now()+interval '10 minutes')
 ON CONFLICT(file_id) DO UPDATE SET lease_token=EXCLUDED.lease_token,
 expires_at=EXCLUDED.expires_at
 WHERE v2_upload_completion_leases.expires_at < now()
 RETURNING lease_token`;
 const leases=await Promise.all([pool.query(leaseQuery,[fileId,tokenA]),pool.query(leaseQuery,[fileId,tokenB])]);
 if(leases.filter(x=>x.rowCount===1).length!==1)
  throw Error('Two concurrent owners acquired the same upload lease');
 const winner=leases.find(x=>x.rowCount===1).rows[0].lease_token;
 const loser=winner===tokenA?tokenB:tokenA;
 const fence=await pool.query(
  `UPDATE library_files SET status='ready' WHERE id=$1 AND status='pending'
   AND EXISTS(SELECT 1 FROM v2_upload_completion_leases
    WHERE file_id=$1 AND lease_token=$2::uuid AND expires_at>now())`,[fileId,loser]);
 if(fence.rowCount!==0)throw Error('Expired/stale lease token bypassed promotion fence');
 const allowed=await pool.query(
  `UPDATE library_files SET status='ready' WHERE id=$1 AND status='pending'
   AND EXISTS(SELECT 1 FROM v2_upload_completion_leases
    WHERE file_id=$1 AND lease_token=$2::uuid AND expires_at>now())`,[fileId,winner]);
 if(allowed.rowCount!==1)throw Error('Lease owner could not finish');
 await pool.query(`INSERT INTO v2_api_rate_limits(scope,subject_hash,window_started_at,hits)
  VALUES('s2-old',repeat('a',64),now()-interval '8 days',1),
   ('s2-new',repeat('b',64),now(),1)`);
 if(await pruneExpiredRateLimits(pool,{batchSize:1})!==1)
  throw Error('Rate-limit cleanup did not remove old row');
 const remaining=await pool.query("SELECT scope FROM v2_api_rate_limits WHERE scope IN ('s2-old','s2-new')");
 if(remaining.rows.length!==1||remaining.rows[0].scope!=='s2-new')
  throw Error('Rate-limit cleanup removed an active row or kept stale one');
 console.log('S2 isolated PostgreSQL migration: PASS (010+011 idempotent DDL, plan isolation, per-file lease fencing, atomic shared rate limits)');
}finally{
 await pool.end();
}
