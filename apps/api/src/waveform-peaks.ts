// Compact streaming envelope: no full decoded song is retained in memory.
export class WaveformEnvelope {
 private peaks:number[]=[];
 private peak=0;
 private frames=0;
 private rate=0;
 private total=0;
 add(channels:Float32Array[],sampleRate:number):void{
  if(!channels.length)return;
  if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000||channels.length>8||
   (this.rate!==0&&this.rate!==sampleRate))throw Error('Invalid audio stream');
  this.rate=sampleRate;
  const samples=channels[0];
  if(channels.some(channel=>channel.length!==samples.length))throw Error('Invalid channels');
  for(let i=0;i<samples.length;i++){
   for(const channel of channels){
    if(!Number.isFinite(channel[i]))throw Error('Invalid audio sample');
    this.peak=Math.max(this.peak,Math.abs(channel[i]));
   }
   if(++this.total>sampleRate*10800)throw Error('Audio duration exceeds waveform limit');
   if(++this.frames===2048){this.peaks.push(this.peak);this.peak=0;this.frames=0;}
  }
 }
 finish():number[]{
  if(!this.total)throw Error('Empty audio');
  if(this.frames)this.peaks.push(this.peak);
  const bars=Array.from({length:84},()=>0);
  for(let i=0;i<this.peaks.length;i++){
   const first=Math.min(83,Math.floor(i*2048*84/this.total));
   const last=Math.min(83,Math.floor((Math.min(this.total,(i+1)*2048)-1)*84/this.total));
   for(let bar=first;bar<=last;bar++)bars[bar]=Math.max(bars[bar],this.peaks[i]);
  }
  const max=Math.max(.001,...bars);
  return bars.map(value=>Math.round(value/max*10000)/10000);
 }
}
export function validWaveform(value:unknown):value is number[]{
 return Array.isArray(value)&&value.length===84&&value.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1);
}
