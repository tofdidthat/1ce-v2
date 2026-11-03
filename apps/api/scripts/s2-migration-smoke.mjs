// PR #27 additive migration gate. Only executes against an ephemeral localhost
// PostgreSQL database named onece_s2_ci. Never connect this script to production.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import pg from 'pg';
import {rateLimitExceeded} from '../src/api-rate-limits.js';

const connectionString=process.env.S2_TEST_DATABASE_URL;
if(!connectionString)throw new Error('S2_TEST_DATABASE_URL is required');
const u=new URL(connectionString);
if(!['postgres:','postgresql:'].includes(u.protocol)||
 !['localhost','127.0.0.1','::1','[::1]'].includes(u.hostname)||
 u.pathname!=='/onece_s2_ci')throw new Error('S2 smoke only runs against local onece_s2_ci');
const file=resolve(dirname(fileURLToPath(import.meta.url)),'../../../history/database/010_api_rate_limits.sql');
const sql=await readFile(file,'utf8');
const pool=new pg.Pool({connectionString,max:8,connectionTimeoutMillis:5000});
try{
 // Reapplying additive migration must be harmless.
 await pool.query(sql);
 await pool.query(sql);
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
 console.log('S2 isolated PostgreSQL migration: PASS (idempotent DDL, hash, concurrent UPSERT, window reset)');
}finally{
 await pool.end();
}
