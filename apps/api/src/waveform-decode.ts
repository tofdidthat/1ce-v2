import {createHash} from 'node:crypto';
import {decoder as mp3Decoder} from '@audio/decode-mp3';
import {decoder as wavDecoder} from '@audio/decode-wav';
import {WaveformEnvelope} from './waveform-peaks.js';
type FileDecoder={decode:(chunk:Uint8Array)=>{channelData:Float32Array[];sampleRate:number};
 flush?:()=>{channelData:Float32Array[];sampleRate:number};free:()=>void};
export async function decodeWaveform(source:AsyncIterable<Uint8Array>,format:'mp3'|'wav',expectedBytes:number,expectedHash:string|null):Promise<number[]>{
 const codec:FileDecoder=await (format==='mp3'?mp3Decoder():wavDecoder());
 const envelope=new WaveformEnvelope(),hash=createHash('sha256');let bytes=0;
 try{
  for await(const chunk of source){
   bytes+=chunk.byteLength;
   if(bytes>expectedBytes||bytes>150*1024*1024)throw Error('Audio size mismatch');
   hash.update(chunk);
   for(let i=0;i<chunk.length;i+=32768){
    const pcm=codec.decode(chunk.subarray(i,i+32768));envelope.add(pcm.channelData,pcm.sampleRate);
   }
  }
  if(codec.flush){const pcm=codec.flush();envelope.add(pcm.channelData,pcm.sampleRate);}
  const digest=hash.digest('hex');
  if(bytes!==expectedBytes||(expectedHash!==null&&digest!==expectedHash))throw Error('Audio integrity mismatch');
  return envelope.finish();
 }finally{codec.free();}
}
