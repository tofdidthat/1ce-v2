// Persisted visual metadata for the ONE player. No audio download/decoding here.
import {useEffect,useState} from 'react';
const api=import.meta.env.VITE_API_URL;
// No result cache: every read revalidates current media permissions.
export async function loadWaveform(fileId:number,ownerId:number,signal?:AbortSignal):Promise<number[]>{
 if(!Number.isSafeInteger(fileId)||fileId<1||!Number.isSafeInteger(ownerId)||ownerId<1)throw Error('Invalid audio');
 for(let attempt=0;attempt<40;attempt++){
  signal?.throwIfAborted();
  const response=await fetch(api+'/api/public/waveform/'+ownerId+'/'+fileId,{credentials:'include',cache:'no-store',signal});
  if(response.status===202||response.status===503){
   await new Promise<void>((resolve,reject)=>{
    const cancel=()=>{clearTimeout(timer);reject(signal?.reason??Error('Aborted'))};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve()},3000);
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted)cancel();
   });continue;
  }
  if(!response.ok)throw Error('Waveform unavailable');
  const payload:unknown=await response.json();
  const bars=payload&&typeof payload==='object'?(payload as Record<string,unknown>).bars:null;
  if(!Array.isArray(bars)||bars.length!==84||!bars.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1))throw Error('Invalid waveform');
  return bars;
 }
 throw Error('Waveform generation pending');
}
export function useWaveform(fileId:number|null,ownerId:number|null){
 const [result,setResult]=useState<{fileId:number;ownerId:number;bars:number[]}|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  setResult(null);
  if(fileId&&ownerId)void loadWaveform(fileId,ownerId,controller.signal).then(bars=>{
   if(!controller.signal.aborted)setResult({fileId,ownerId,bars});
  }).catch(()=>{});
  return()=>controller.abort();
 },[fileId,ownerId]);
 return result?.fileId===fileId&&result?.ownerId===ownerId?result.bars:[];
}
