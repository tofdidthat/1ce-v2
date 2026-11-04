// Plan-dependent R2 quotas; do not infer an entitlement from UI flags or a
// payment status. The only seeded plan is "default" (10 GiB). Future billing
// must assign plans server-side in a separately approved workflow.
import type {AccountIdV2,QueryableV2} from '../../../packages/shared/contracts.js';
export const GIB=1024*1024*1024;
export async function accountStorageQuota(db:QueryableV2,userId:AccountIdV2|string):Promise<number>{
 if(!Number.isSafeInteger(Number(userId))||Number(userId)<1)
  throw new Error('Invalid storage account');
 const result=await db.query(`SELECT storage_limit_bytes
  FROM v2_storage_plans
  WHERE code=COALESCE(
   (SELECT plan_code FROM v2_account_storage_plans WHERE user_id=$1),
   'default'
  ) LIMIT 1`,[userId]);
 const raw=result.rows[0]?.storage_limit_bytes;
 const bytes=Number(raw);
 if(!Number.isSafeInteger(bytes)||bytes<GIB/1024||bytes>1024*GIB)
  throw new Error('Storage entitlement unavailable');
 return bytes;
}
