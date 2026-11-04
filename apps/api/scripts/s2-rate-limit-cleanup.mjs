// Opt-in bounded cleanup for the isolated 1CE v2 PostgreSQL rate window
// table. No schedule or Railway service is provisioned by PR #27.
// Run only from a separately authorized cron job with v2 DATABASE_URL.
import pg from 'pg';
import {pruneExpiredRateLimits} from '../dist/api-rate-limits.js';

if(process.env.V2_RATE_LIMIT_CLEANUP_ENABLED!=='true')
 throw new Error('Explicit V2_RATE_LIMIT_CLEANUP_ENABLED=true required');
if(!process.env.DATABASE_URL)
 throw new Error('DATABASE_URL for isolated v2 PostgreSQL is required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,
 connectionTimeoutMillis:5000,statement_timeout:15000});
try{
 let total=0;
 for(let i=0;i<20;i++){
  const removed=await pruneExpiredRateLimits(pool,{batchSize:500});
  total+=removed;
  if(removed<500)break;
 }
 console.log('1CE v2 old rate-limit rows pruned:',total);
}finally{await pool.end();}
