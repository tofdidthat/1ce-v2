import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleProfileFollows} from '../dist/profile-follows.js';

function fixture(){
 const users=new Map([[1,{id:1,username:'one',name:'One',picture:null,has_avatar:false,avatar_updated_at:null}],[2,{id:2,username:'two',name:'Two',picture:null,has_avatar:false,avatar_updated_at:null}],[3,{id:3,username:'three',name:'Three',picture:null,has_avatar:false,avatar_updated_at:null}]]);
 const rows=new Map(),calls=[];
 const pool={calls,rows,async query(sql,args=[]){
  calls.push({sql,args});
  if(sql.startsWith('CREATE TABLE')||sql.startsWith('CREATE INDEX'))return {rowCount:0,rows:[]};
  if(sql==='SELECT id FROM account_users WHERE id=$1'){
   const user=users.get(Number(args[0]));return {rowCount:user?1:0,rows:user?[user]:[]};
  }
  if(sql.startsWith('INSERT INTO v2_profile_follows')){
   const key=args.join(':');if(!rows.has(key))rows.set(key,{follower:Number(args[0]),followed:Number(args[1]),created:rows.size});
   return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('DELETE FROM v2_profile_follows')){
   rows.delete(args.join(':'));return {rowCount:1,rows:[]};
  }
  if(sql==='SELECT 1 FROM v2_profile_follows WHERE follower_id=$1 AND followed_id=$2'){
   const found=rows.has(args.join(':'));return {rowCount:found?1:0,rows:found?[{ok:1}]:[]};
  }
  if(sql.startsWith('SELECT count(*)::int AS count FROM v2_profile_follows')){
   const byFollower=sql.includes('WHERE follower_id=$1');
   const count=[...rows.values()].filter(row=>(byFollower?row.follower:row.followed)===Number(args[0])).length;
   return {rowCount:1,rows:[{count}]};
  }
  if(sql.includes('FROM v2_profile_follows f JOIN account_users u')){
   const followed=[...rows.values()].filter(row=>row.follower===Number(args[0])).sort((a,b)=>b.created-a.created);
   return {rowCount:followed.length,rows:followed.map(row=>users.get(row.followed))};
  }
  throw Error('Unexpected SQL '+sql);
 }};
 return pool;
}
async function request(pool,method,target,viewerId=null){
 const req={method,headers:{}};
 const res={status:0,body:null,writeHead(status){this.status=status},end(text){this.body=JSON.parse(text)}};
 assert.equal(await handleProfileFollows(req,res,'/api/public/follows/'+target,pool,async()=>viewerId===null?null:{id:viewerId}),true);
 return res;
}
test('GET following is public but viewer-follow status is session-specific',async()=>{
 const db=fixture();
 assert.equal((await request(db,'POST',2,1)).status,200);
 assert.equal((await request(db,'POST',3,2)).status,200);
 const anonymous=await request(db,'GET',2);
 assert.equal(anonymous.status,200);
 assert.equal(anonymous.body.followersCount,1);
 assert.equal(anonymous.body.followingCount,1);
 assert.equal(anonymous.body.viewerFollows,false);
 assert.deepEqual(anonymous.body.followingUsers.map(u=>u.username),['three']);
 assert.equal((await request(db,'GET',2,1)).body.viewerFollows,true);
 assert.equal((await request(db,'GET',2,3)).body.viewerFollows,false);
 assert.ok(!JSON.stringify(anonymous.body).includes('email'));
});
test('Follow/Unfollow is durable, idempotent, and affects only the authenticated follower',async()=>{
 const db=fixture();
 await request(db,'POST',2,1);
 const followed=await request(db,'POST',2,1);
 assert.equal(followed.body.followersCount,1);
 assert.equal(db.rows.size,1);
 assert.equal((await request(db,'GET',2,1)).body.viewerFollows,true);
 const unfollow=await request(db,'DELETE',2,1);
 assert.equal(unfollow.body.viewerFollows,false);
 assert.equal(unfollow.body.followersCount,0);
 assert.equal((await request(db,'DELETE',2,1)).status,200);
 assert.equal(db.rows.size,0);
 assert.equal((await request(db,'GET',2,1)).body.viewerFollows,false);
 const mutating=db.calls.filter(x=>x.sql.startsWith('INSERT INTO v2_profile_follows')||x.sql.startsWith('DELETE FROM v2_profile_follows'));
 assert.ok(mutating.every(x=>Number(x.args[0])===1&&Number(x.args[1])===2));
});
test('anonymous writes, self-follow, and nonexistent targets are rejected without inserting',async()=>{
 const db=fixture();
 assert.equal((await request(db,'POST',2,null)).status,401);
 assert.equal((await request(db,'DELETE',2,null)).status,401);
 assert.equal((await request(db,'POST',1,1)).status,400);
 assert.equal((await request(db,'DELETE',1,1)).status,400);
 assert.equal((await request(db,'POST',999,1)).status,404);
 assert.equal((await request(db,'GET',999,1)).status,404);
 assert.equal((await request(db,'GET',0,null)).status,404);
 const unmatched={method:'GET'};
 const unused={status:0,writeHead(status){this.status=status},end(){}};
 assert.equal(await handleProfileFollows(unmatched,unused,'/api/public/follows/not-a-user',db,async()=>null),false);
 assert.equal(db.rows.size,0);
});
test('only explicit follow resource can handle its own route; wrong method is blocked',async()=>{
 const db=fixture(),res={status:0,writeHead(code){this.status=code},end(){}};
 assert.equal(await handleProfileFollows({method:'GET'},res,'/api/public/profile/2',db,async()=>null),false);
 assert.equal((await request(db,'PATCH',2,1)).status,405);
});
test('durable v2-only schema protects relationships and cleans up on account deletion',()=>{
 const sql=readFileSync(new URL('../../../history/database/008_profile_follows.sql',import.meta.url),'utf8');
 assert.match(sql,/v2_profile_follows/);
 assert.match(sql,/PRIMARY KEY \(follower_id, followed_id\)/);
 assert.match(sql,/CHECK \(follower_id <> followed_id\)/);
 assert.match(sql,/REFERENCES account_users\(id\) ON DELETE CASCADE/g);
 assert.match(sql,/CREATE INDEX IF NOT EXISTS v2_profile_follows_followed_idx/);
 const server=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
 assert.match(server,/handleProfileFollows\(req,res,pathname,pool,currentUser\)/);
});
