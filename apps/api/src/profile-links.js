// Account-owned social URLs stored in v2 PostgreSQL. No extra HTTP route or OAuth.
const readyByPool=new WeakMap();
export async function ensureProfileLinksV2(pool){
 let task=readyByPool.get(pool);
 if(!task){
  task=pool.query(`CREATE TABLE IF NOT EXISTS v2_profile_links (
   user_id INTEGER PRIMARY KEY REFERENCES account_users(id) ON DELETE CASCADE,
   links JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(links)='array'),
   updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`).catch(error=>{readyByPool.delete(pool);throw error});
  readyByPool.set(pool,task);
 }
 await task;
}
const localIp=host=>/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)||host.includes(':');
export function normalizeProfileLinksV2(value){
 if(!Array.isArray(value)||value.length>6)return null;
 const cleaned=[],seen=new Set();
 for(const item of value){
  if(typeof item!=='string'||item.length>520)return null;
  const raw=item.trim();
  if(!raw||raw.length>500||/[\x00-\x20\x7f]/.test(raw))return null;
  let url;
  try{url=new URL(raw)}catch{return null}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||!host.includes('.')||
     host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||
     host.endsWith('.internal')||localIp(host)||url.port)return null;
  const text=url.toString();
  if(text.length>500||seen.has(text))return null;
  seen.add(text);cleaned.push(text);
 }
 return cleaned;
}
export async function readProfileLinksV2(pool,userId){
 await ensureProfileLinksV2(pool);
 const result=await pool.query('SELECT links FROM v2_profile_links WHERE user_id=$1',[userId]);
 const value=result.rows[0]?.links;
 return Array.isArray(value)?value:[];
}
export async function storeProfileLinksV2(db,userId,links){
 await db.query(`INSERT INTO v2_profile_links(user_id,links) VALUES($1,$2::jsonb)
  ON CONFLICT(user_id) DO UPDATE SET links=EXCLUDED.links,updated_at=now()`,
  [userId,JSON.stringify(links)]);
}
