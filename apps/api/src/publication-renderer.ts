import {spawn,spawnSync} from 'node:child_process';
import {stat} from 'node:fs/promises';
import {PublishingError} from './youtube-connection.js';
const binary=()=>process.env.FFMPEG_PATH||'ffmpeg';
let capability:{path:string;available:boolean}|null=null;
export function publicationRendererAvailable():boolean{
 const path=binary();if(capability?.path===path)return capability.available;
 const result=spawnSync(path,['-version'],{timeout:5000,windowsHide:true,stdio:'ignore'});
 capability={path,available:result.status===0};return capability.available;
}
function run(args:string[],{signal,output,timeout=15000}:{signal:AbortSignal;output?:string;timeout?:number}):Promise<{code:number|null;stderr:string}>{
 return new Promise((resolve,reject)=>{
  signal.throwIfAborted();
  const child=spawn(binary(),args,{windowsHide:true,stdio:['ignore','ignore','pipe'],shell:false});
  let stderr='',limit=false,checking=false;
  const stop=()=>child.kill('SIGKILL');
  const timer=setTimeout(()=>{limit=true;stop()},timeout);
  const check=output?setInterval(()=>{
   if(checking)return;checking=true;
   void stat(output).then(s=>{if(s.size>256*1024*1024){limit=true;stop()}},()=>{}).finally(()=>{checking=false});
  },1000):null;
  signal.addEventListener('abort',stop,{once:true});
  const clean=()=>{clearTimeout(timer);if(check)clearInterval(check);signal.removeEventListener('abort',stop)};
  child.stderr.on('data',(chunk:Buffer)=>{if(stderr.length<16384)stderr+=chunk.toString().slice(0,16384-stderr.length)});
  child.once('error',()=>{clean();reject(new PublishingError('renderer_unavailable',503))});
  child.once('close',code=>{clean();
   if(signal.aborted)return reject(new PublishingError('publication_cancelled',409));
   if(limit)return reject(new PublishingError('render_limit_exceeded',422));
   resolve({code,stderr});
  });
 });
}
export function parseMediaDuration(stderr:string):number{
 const match=/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
 if(!match)throw new PublishingError('audio_duration_unavailable',422);
 const seconds=Number(match[1])*3600+Number(match[2])*60+Number(match[3]);
 if(!Number.isFinite(seconds)||seconds<=0||seconds>1200)throw new PublishingError('audio_must_be_under_20_minutes',422);
 return seconds;
}
export async function renderPublication({audio,cover,output,variant,signal}:{
 audio:string;cover:string;output:string;variant:'shorts'|'standard';signal:AbortSignal
}):Promise<void>{
 if(!publicationRendererAvailable())throw new PublishingError('renderer_unavailable',503);
 const audioInfo=await run(['-hide_banner','-nostdin','-max_alloc','67108864','-protocol_whitelist','file,pipe','-i',audio],{signal});
 const duration=parseMediaDuration(audioInfo.stderr);
 const imageInfo=await run(['-hide_banner','-nostdin','-max_alloc','67108864','-protocol_whitelist','file,pipe','-i',cover],{signal});
 const dimensions=/,\s*(\d{1,6})x(\d{1,6})(?:[,\s\[])/.exec(imageInfo.stderr);
 if(!dimensions||Number(dimensions[1])*Number(dimensions[2])>32000000||Number(dimensions[1])>8192||Number(dimensions[2])>8192)throw new PublishingError('cover_dimensions_too_large',422);
 const [width,height]=variant==='shorts'?[720,1280]:[1280,720];
 const result=await run(['-hide_banner','-nostdin','-loglevel','error','-y','-max_alloc','67108864',
  '-protocol_whitelist','file,pipe','-loop','1','-framerate','2','-i',cover,
  '-protocol_whitelist','file,pipe','-i',audio,'-map','0:v:0','-map','1:a:0',
  '-vf',`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
  '-c:v','libx264','-preset','veryfast','-tune','stillimage','-crf','23','-pix_fmt','yuv420p','-threads','2',
  '-r','30','-c:a','aac','-b:a','192k','-shortest','-t',String(duration),'-map_metadata','-1','-movflags','+faststart',output],
 {signal,output,timeout:30*60*1000});
 if(result.code!==0)throw new PublishingError('video_render_failed',422);
 const size=(await stat(output)).size;
 if(size<1||size>256*1024*1024)throw new PublishingError('render_limit_exceeded',422);
}
