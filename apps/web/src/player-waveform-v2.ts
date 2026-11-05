// Owner-keyed waveform decoding/cache for the ONE persistent audio player.
// A waveform is visual metadata; its failure never blocks playback. No R2
// objects are written, and viewer IDs are part of every cache key.
import {useEffect,useState} from 'react';
const api=import.meta.env.VITE_API_URL;
// Private, per-page waveform cache. Start decoding before playback when possible.
const waveCache=new Map<string,number[]>();
const wavePending=new Map<string,Promise<number[]>>();
export function loadWaveform(fileId:number,ownerId:number):Promise<number[]>{
 const key=String(ownerId)+':'+String(fileId);
 const cached=waveCache.get(key);
 if(cached)return Promise.resolve(cached);
 const existing=wavePending.get(key);
 if(existing)return existing;
 const pending=(async()=>{
  let context:AudioContext|null=null;
  try{
   const response=await fetch(api+'/api/public/audio/'+ownerId+'/'+fileId,{credentials:'include'});
   if(!response.ok)throw Error('Waveform unavailable');
   const bytes=await response.arrayBuffer();
   context=new AudioContext();
   const decoded=await context.decodeAudioData(bytes);
   const samples=decoded.getChannelData(0);
   const count=84;
   const size=Math.max(1,Math.floor(samples.length/count));
   const peaks=Array.from({length:count},(_,index)=>{
    let peak=0;
    const end=Math.min(samples.length,(index+1)*size);
    for(let i=index*size;i<end;i+=32)peak=Math.max(peak,Math.abs(samples[i]));
    return peak;
   });
   const max=Math.max(...peaks,.001);
   const bars=peaks.map(value=>value/max);
   if(waveCache.size>=16)waveCache.delete(waveCache.keys().next().value!);
   waveCache.set(key,bars);
   return bars;
  }finally{
   wavePending.delete(key);
   if(context&&context.state!=='closed')await context.close().catch(()=>{});
  }
 })();
 wavePending.set(key,pending);
 return pending;
}
export function useWaveform(fileId:number|null,ownerId:number|null){
 const [bars,setBars]=useState<number[]>([]);
 useEffect(()=>{
  let active=true;
  const key=ownerId&&fileId?String(ownerId)+':'+String(fileId):null;
  setBars(key?waveCache.get(key)||[]:[]);
  if(fileId&&ownerId)loadWaveform(fileId,ownerId).then(value=>{if(active)setBars(value)}).catch(()=>{});
  return()=>{active=false};
 },[fileId,ownerId]);
 return bars;
}
