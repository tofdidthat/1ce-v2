// Follows/Following state and mutations are viewer- and target-scoped.
// Profile presentation passes only a server-verified target ID. Backend
// authorization remains authoritative; Save never grants private access.
import React,{useState} from 'react';
import {subscribeV2DataChanges,subscribeV2Resume,notifyV2DataChanged} from './data-refresh-v2';
import {getProfileFollowsV2,setProfileFollowV2,type ProfileFollowsV2} from './profile-follows-v2';

type Args={active:boolean;targetId:string;userId?:number|null;followKey:string;resolvedTargetId:number|null;isOwner:boolean;onLogin:()=>void};

export default function useProfileFollowsV2({active,targetId,userId,followKey,resolvedTargetId,isOwner,onLogin}:Args){
 const [followRevision,setFollowRevision]=useState(0);
 const [followState,setFollowState]=useState<{key:string;status:'loading'|'ready'|'error';data:ProfileFollowsV2|null}>({key:'',status:'loading',data:null});
 const [followError,setFollowError]=useState('');
 const [followBusy,setFollowBusy]=useState(false);
 const currentFollowRequest=React.useRef('');
 currentFollowRequest.current=followKey;
 const followStatus=followState.key===followKey?followState.status:'loading';
 const followData=followState.key===followKey?followState.data:null;
 const previouslyActive=React.useRef(active);
 React.useEffect(()=>{
  if(active&&!previouslyActive.current)setFollowRevision(value=>value+1);
  previouslyActive.current=active;
 },[active]);
 React.useEffect(()=>{
  if(!active)return;
  return subscribeV2DataChanges(['follows'],()=>setFollowRevision(v=>v+1),userId);
 },[active,targetId,userId]);
 React.useEffect(()=>{
  if(!active)return;
  return subscribeV2Resume(()=>setFollowRevision(v=>v+1));
 },[active,targetId,userId]);
 React.useEffect(()=>{setFollowBusy(false);},[followKey]);

 React.useEffect(()=>{
  if(!resolvedTargetId){setFollowState({key:followKey,status:'loading',data:null});return;}
  const controller=new AbortController();
  setFollowState(previous=>({key:followKey,status:'loading',data:previous.key===followKey?previous.data:null}));setFollowError('');
  void getProfileFollowsV2(resolvedTargetId,controller.signal).then(data=>{
   if(!controller.signal.aborted)setFollowState({key:followKey,status:'ready',data});
  }).catch(caught=>{
   if(!controller.signal.aborted){
    setFollowState({key:followKey,status:'error',data:null});
    setFollowError(caught instanceof Error?caught.message:'Unable to load following');
   }
  });
  return()=>controller.abort();
 },[followKey,followRevision]);

 const changeFollow=async()=>{
  if(!userId){onLogin();return;}
  if(!resolvedTargetId||isOwner||followStatus!=='ready'||!followData||followBusy)return;
  const key=followKey;
  setFollowBusy(true);setFollowError('');
  try{
   const result=await setProfileFollowV2(resolvedTargetId,followData.viewerFollows);
   if(currentFollowRequest.current===key){
    setFollowState(previous=>previous.key===key&&previous.data?
     {...previous,data:{...previous.data,viewerFollows:result.viewerFollows,followersCount:result.followersCount}}:previous);
   }
   notifyV2DataChanged(['follows'],Number(userId));
  }catch(caught){
   if(currentFollowRequest.current===key)setFollowError(caught instanceof Error?caught.message:'Unable to update follow');
  }finally{if(currentFollowRequest.current===key)setFollowBusy(false);}
 };

 return {followStatus,followData,followError,followBusy,changeFollow,retryFollow:()=>setFollowRevision(v=>v+1)};
}
