// 1CE v2: social follow relationships are PostgreSQL-only; no project/media grant.
import type {QueryableV2} from '../../../packages/shared/contracts.js';

type FollowRequest={method?:string};
type FollowResponse={
 writeHead(status:number,headers:Record<string,string>):void;
 end(body?:string):void;
};
type FollowViewer={id:number};
type GetViewer<Request extends FollowRequest>=(request:Request)=>Promise<FollowViewer|null>;

const send=(res:FollowResponse,status:number,data:unknown):void=>{
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
 res.end(JSON.stringify(data));
};
let schemaPromise:Promise<void>|null=null;
function ready(pool:QueryableV2):Promise<void>{
 if(!schemaPromise)schemaPromise=(async()=>{
  await pool.query(`CREATE TABLE IF NOT EXISTS v2_profile_follows (
   follower_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
   followed_id INTEGER NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
   created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
   PRIMARY KEY (follower_id,followed_id),
   CONSTRAINT v2_profile_follows_no_self CHECK (follower_id<>followed_id)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS v2_profile_follows_followed_idx ON v2_profile_follows(followed_id,created_at DESC)');
 })().catch(error=>{schemaPromise=null;throw error});
 return schemaPromise;
}

export async function handleProfileFollows<Request extends FollowRequest>(req:Request,res:FollowResponse,pathname:string,pool:QueryableV2,currentUser:GetViewer<Request>):Promise<boolean>{
 const match=/^\/api\/public\/follows\/(\d+)$/.exec(pathname);
 if(!match)return false;
 if(!['GET','POST','DELETE'].includes(req.method||'')){send(res,405,{error:'Method not allowed'});return true;}
 const targetId=Number(match[1]);
 if(!Number.isSafeInteger(targetId)||targetId<1||targetId>2147483647){
  send(res,404,{error:'Profile not found'});return true;
 }
 const viewer=await currentUser(req);
 if(req.method!=='GET'&&!viewer){send(res,401,{error:'Sign in to follow'});return true;}
 if(req.method!=='GET'&&Number(viewer!.id)===targetId){
  send(res,400,{error:'You cannot follow yourself'});return true;
 }
 await ready(pool);
 const target=await pool.query('SELECT id FROM account_users WHERE id=$1',[targetId]);
 if(!target.rowCount){send(res,404,{error:'Profile not found'});return true;}
 if(req.method==='GET'){
  const [followers,following,users,viewerRelation]=await Promise.all([
   pool.query('SELECT count(*)::int AS count FROM v2_profile_follows WHERE followed_id=$1',[targetId]),
   pool.query('SELECT count(*)::int AS count FROM v2_profile_follows WHERE follower_id=$1',[targetId]),
   pool.query(`SELECT u.id,u.username,u.name,u.picture,
    (u.avatar_key IS NOT NULL) AS has_avatar,u.avatar_updated_at
    FROM v2_profile_follows f JOIN account_users u ON u.id=f.followed_id
    WHERE f.follower_id=$1 ORDER BY f.created_at DESC LIMIT 200`,[targetId]),
   viewer?.id?pool.query('SELECT 1 FROM v2_profile_follows WHERE follower_id=$1 AND followed_id=$2',[viewer.id,targetId]):Promise.resolve({rowCount:0})
  ]);
  send(res,200,{
   followersCount:Number(followers.rows[0]?.count||0),
   followingCount:Number(following.rows[0]?.count||0),
   viewerFollows:Boolean(viewer?.id&&viewerRelation.rowCount),
   followingUsers:users.rows
  });
  return true;
 }
 if(req.method==='POST'){
  await pool.query('INSERT INTO v2_profile_follows(follower_id,followed_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[viewer!.id,targetId]);
 }else{
  await pool.query('DELETE FROM v2_profile_follows WHERE follower_id=$1 AND followed_id=$2',[viewer!.id,targetId]);
 }
 const count=await pool.query('SELECT count(*)::int AS count FROM v2_profile_follows WHERE followed_id=$1',[targetId]);
 send(res,200,{ok:true,viewerFollows:req.method==='POST',followersCount:Number(count.rows[0]?.count||0)});
 return true;
}
