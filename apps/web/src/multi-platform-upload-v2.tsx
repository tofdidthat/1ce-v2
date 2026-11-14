import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,Check,Globe2,ImagePlus,Music2,UploadCloud,Video} from 'lucide-react';
import './multi-platform-upload-v2.css';
import {publishingRequest,canRetryPublishingTarget,publishingErrorMessage,type PublishingStatus,type PublishingPayload} from './publishing-api-v2';
import {uploadPublishingFile} from './upload-file-v2';

type Platform='YouTube'|'TikTok'|'Instagram'|'Telegram'|'Discord';
type Format='vertical'|'horizontal';
const platforms:Platform[]=['YouTube','TikTok','Instagram','Telegram','Discord'];
const formats:{id:Format;label:string;ratio:string}[]=[
 {id:'vertical',label:'Vertical',ratio:'9:16'},
 {id:'horizontal',label:'Horizontal',ratio:'16:9'}
];

type Props={
 userId?:number;
 active:boolean;
 initialAudio:File|null;
 initialCover:File|null;
 initialTitle:string;
 onBack:()=>void;
};

export default function MultiPlatformUploadV2({userId,active,initialAudio,initialCover,initialTitle,onBack}:Props){
 const [visual,setVisual]=useState<File|null>(null);
 const [video,setVideo]=useState<File|null>(null);
 const [audio,setAudio]=useState<File|null>(null);
 const [videoAudioMode,setVideoAudioMode]=useState<'original'|'replace'>('original');
 const [title,setTitle]=useState(initialTitle);
 const [description,setDescription]=useState('');
 const [hashtags,setHashtags]=useState('#shorts #music');
 const [selectedPlatforms,setSelectedPlatforms]=useState<Platform[]>([]);
 const [selectedYouTubeFormats,setSelectedYouTubeFormats]=useState<Format[]>(['vertical']);
 const visualInput=useRef<HTMLInputElement|null>(null);
 const audioInput=useRef<HTMLInputElement|null>(null);
 useEffect(()=>{if(initialTitle)setTitle(current=>current||initialTitle)},[initialTitle]);
 const image=video?null:(visual||initialCover);
 const audioFile=audio||initialAudio;
 const api=import.meta.env.VITE_API_URL||'';
 const [privacy,setPrivacy]=useState<PublishingPayload['privacy']>('private');
 const [status,setStatus]=useState<{viewer:number;value:PublishingStatus}|null>(null);
 const currentStatus=status&&status.viewer===userId?status.value:null;
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [failure,setFailure]=useState('');
 const [revision,setRevision]=useState(0);
 const operation=useRef<AbortController|null>(null);
 const pending=useRef<PublishingPayload|null>(null);
 const viewer=useRef(userId);viewer.current=userId;
 useEffect(()=>{pending.current=null;},[title,description,hashtags,privacy,audioFile,image,video,selectedPlatforms,selectedYouTubeFormats]);
 useEffect(()=>{
  operation.current?.abort();operation.current=null;pending.current=null;
  setStatus(null);setBusy(false);setNotice('');setFailure('');
  setAudio(null);setVisual(null);setVideo(null);setTitle(initialTitle);setDescription('');setHashtags('#shorts #music');setPrivacy('private');setSelectedPlatforms([]);setSelectedYouTubeFormats(['vertical']);
  return()=>{operation.current?.abort();};
 },[userId]);
 useEffect(()=>{
  if(!active||!userId)return;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   try{
    const value=await publishingRequest<PublishingStatus>(api,'/status',controller.signal);
    if(!controller.signal.aborted)setStatus({viewer:userId,value});
   }catch(error){if(!controller.signal.aborted){setStatus(null);setFailure(error instanceof Error?error.message:'Unable to load publishing status');}}
   finally{if(!controller.signal.aborted)timer=setTimeout(poll,5000);}
  };
  void poll();return()=>{controller.abort();clearTimeout(timer);};
 },[active,userId,api,revision]);
 useEffect(()=>{if(!active){operation.current?.abort();operation.current=null;setBusy(false);}},[active]);
 const act=async(task:(signal:AbortSignal)=>Promise<void>)=>{
  if(operation.current||!userId||!active)return;
  const controller=new AbortController(),account=userId;operation.current=controller;setBusy(true);setFailure('');setNotice('');
  try{await task(controller.signal);if(!controller.signal.aborted&&viewer.current===account)setRevision(v=>v+1);}
  catch(error){if(!controller.signal.aborted&&viewer.current===account)setFailure(error instanceof Error?error.message:'Publishing failed');}
  finally{if(operation.current===controller){operation.current=null;setBusy(false);}}
 };
 const submit=()=>void act(async signal=>{
  if(!currentStatus?.available||!currentStatus.connected||video||!audioFile||!image||!title.trim()||selectedPlatforms.length!==1||selectedPlatforms[0]!=='YouTube')return;
  if(!pending.current){
   setNotice('Uploading audio…');const audioFileId=await uploadPublishingFile(api,audioFile,'audio',signal);
   signal.throwIfAborted();setNotice('Uploading image…');const coverFileId=await uploadPublishingFile(api,image,'cover',signal);
   signal.throwIfAborted();
   pending.current={requestId:crypto.randomUUID(),title:title.trim(),description,hashtags,privacy,audioFileId,coverFileId,targets:selectedYouTubeFormats.map(format=>({platform:'youtube',variant:format==='vertical'?'shorts':'standard'}))};
  }
  setNotice('Submitting to queue…');
  await publishingRequest<{id:string;state:string}>(api,'/jobs',signal,pending.current);
  signal.throwIfAborted();pending.current=null;setNotice('Accepted by the publishing queue. Follow progress below.');
 });
 const visualUrl=useMemo(()=>video?URL.createObjectURL(video):image?URL.createObjectURL(image):'',[video,image]);
 useEffect(()=>()=>{if(visualUrl)URL.revokeObjectURL(visualUrl)},[visualUrl]);
 const audioUrl=useMemo(()=>audioFile?URL.createObjectURL(audioFile):'',[audioFile]);
 useEffect(()=>()=>{if(audioUrl)URL.revokeObjectURL(audioUrl)},[audioUrl]);

 const selectVisual=(file:File|undefined)=>{
  if(!file)return;
  if(file.type.startsWith('image/')||/\.(png|jpg|jpeg|webp)$/i.test(file.name)){
   setVisual(file);setVideo(null);
  }else if(file.type.startsWith('video/')||/\.(mp4|mov|webm)$/i.test(file.name)){
   setVideo(file);setVisual(null);setVideoAudioMode('original');
  }
 };
 const togglePlatform=(platform:Platform)=>{
  setSelectedPlatforms(current=>current.includes(platform)?current.filter(item=>item!==platform):[...current,platform]);
 };
 const toggleYouTubeFormat=(format:Format)=>{
  setSelectedYouTubeFormats(current=>current.includes(format)
   ?(current.length===1?current:current.filter(item=>item!==format))
   :[...current,format]);
 };
 const youtubeSelected=selectedPlatforms.includes('YouTube');
 const previewFormats=youtubeSelected
  ? formats.filter(format=>selectedYouTubeFormats.includes(format.id))
  : formats.filter(format=>format.id==='vertical');

 return (
  <section className="onece-multi-upload" aria-label="1CE Upload" hidden={!active}>
   <header className="onece-multi-heading">
    <button type="button" className="onece-multi-back" onClick={onBack}>
     <ArrowLeft size={18}/> Back to Home upload
    </button>
    <div className="onece-multi-title"><Globe2 size={22}/><h1>1CE Upload</h1></div>
    <p>Prepare one upload for multiple platforms. Inspired by the original 1CE workflow.</p>
   </header>

   <div className="onece-multi-grid">
    <div className="onece-multi-fields">
     <fieldset disabled={busy} className="onece-multi-editable">
     <div className="onece-multi-panel">
      <h2>Media</h2>
      <div className="onece-multi-media-pickers">
       <button type="button" className="onece-multi-file-button" onClick={()=>visualInput.current?.click()}>
        {video?<Video size={21}/>:image?<ImagePlus size={21}/>:<UploadCloud size={21}/>}
        <strong>{video?.name||image?.name||'Choose image or video'}</strong>
        <span>PNG, JPG, WEBP, MP4, MOV, WEBM</span>
       </button>
       <input ref={visualInput} type="file" hidden accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
        onChange={event=>{selectVisual(event.target.files?.[0]);event.target.value=''}}/>
       <button type="button" className="onece-multi-file-button" onClick={()=>audioInput.current?.click()}>
        <Music2 size={21}/>
        <strong>{audioFile?.name||'Choose audio'}</strong>
        <span>MP3 or WAV</span>
       </button>
       <input ref={audioInput} type="file" hidden accept=".mp3,.wav,audio/mpeg,audio/wav"
        onChange={event=>{
         const file=event.target.files?.[0];
         event.target.value='';
         if(file&&/\.(mp3|wav)$/i.test(file.name))setAudio(file);
        }}/>
      </div>
      {video&&<div className="onece-multi-audio-mode" role="group" aria-label="Video audio">
       <button type="button" aria-pressed={videoAudioMode==='original'} onClick={()=>setVideoAudioMode('original')}>Original audio</button>
       <button type="button" aria-pressed={videoAudioMode==='replace'} onClick={()=>setVideoAudioMode('replace')}>Replace audio</button>
      </div>}
     </div>

     <div className="onece-multi-panel onece-multi-metadata">
      <h2>Details</h2>
      <label>Title<input maxLength={100} value={title} onChange={event=>setTitle(event.target.value)} placeholder="Title"/></label>
      <label>Description<textarea rows={3} value={description} onChange={event=>setDescription(event.target.value)} placeholder="Description shown on platforms"/></label>
      <label>Hashtags<input value={hashtags} onChange={event=>setHashtags(event.target.value)} placeholder="#music #beats"/></label>
      <label>Visibility<select value={privacy} onChange={event=>setPrivacy(event.target.value as PublishingPayload['privacy'])}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label>
     </div>

     <div className="onece-multi-panel">
      <h2>Destinations</h2>
      <p className="onece-multi-hint">Choose the platforms you want to publish to when connections are available.</p>
      <div className="onece-multi-destinations" role="group" aria-label="Destination platforms">
       {platforms.map(platform=><button key={platform} type="button" aria-pressed={selectedPlatforms.includes(platform)}
        onClick={()=>togglePlatform(platform)}>
         <span className="onece-multi-checkbox">{selectedPlatforms.includes(platform)&&<Check size={13}/>}</span>
         {platform}
       </button>)}
      </div>
      {youtubeSelected&&<div className="onece-multi-youtube-options">
       <h3>YouTube video formats</h3>
       <p className="onece-multi-hint">Choose Shorts (9:16), standard video (16:9), or both.</p>
       <div className="onece-multi-formats" role="group" aria-label="YouTube video formats">
        {formats.map(format=><button type="button" key={format.id} aria-pressed={selectedYouTubeFormats.includes(format.id)}
         onClick={()=>toggleYouTubeFormat(format.id)}>
         <span className="onece-multi-checkbox">{selectedYouTubeFormats.includes(format.id)&&<Check size={13}/>}</span>
         <span>{format.id==='vertical'?'Shorts':'Standard video'}<small>{format.ratio}</small></span>
        </button>)}
       </div>
      </div>}
      <p className="onece-multi-hint">YouTube supports image + MP3/WAV, up to 20 minutes. Audio: 150 MiB; image: 15 MiB, 32 megapixels, 8192 pixels per side. Other platforms and original video are preview only.</p>
      <p>{!userId?'Sign in to publish.':!currentStatus?'Checking publishing availability…':!currentStatus.available?'Publishing is unavailable on this server.':currentStatus.connected?'YouTube connected':'Connect YouTube to publish.'}</p>
      <button type="button" disabled={!currentStatus} onClick={()=>void act(async signal=>{
       if(currentStatus?.connected){await publishingRequest(api,'/youtube/disconnect',signal,{});signal.throwIfAborted();setStatus(null);}
       else{const result=await publishingRequest<{url:string}>(api,'/youtube/connect',signal,{});signal.throwIfAborted();const url=new URL(result.url);if(url.protocol!=='https:')throw Error('Invalid authorization URL');window.location.assign(url.href);}
      })}>{currentStatus?.connected?'Disconnect YouTube':'Connect YouTube'}</button>
     </div>
     </fieldset>
     <div className="onece-multi-publish">
      <button type="button" onClick={submit} disabled={busy||!active||!userId||!currentStatus?.available||!currentStatus.connected||!audioFile||!image||!!video||!title.trim()||selectedPlatforms.length!==1||!youtubeSelected}>Publish to YouTube</button>
      {notice&&<p role="status">{notice}</p>}{failure&&<p role="alert">{failure}</p>}
      {video&&<p>Original video publishing is unavailable. Choose an image and MP3/WAV audio.</p>}
      {selectedPlatforms.some(platform=>platform!=='YouTube')&&<p>Only YouTube is available. Remove preview destinations before publishing.</p>}
      <p>After an uncertain submit error, retry without editing to reuse the same request. An accepted job is not yet a published video.</p>
     </div>
     <section className="onece-multi-panel" aria-label="Publishing history"><h2>Publishing history</h2>
      {currentStatus?.jobs.map(job=><article key={job.id}><h3>{job.title}</h3><p>{job.state}</p>{job.targets.map(target=><div key={target.id}><span>{target.platform} · {target.variant} · {target.state}{target.errorCode?' · '+publishingErrorMessage(target.errorCode):''}</span>{target.remoteId&&target.platform==='youtube'&&<a href={'https://www.youtube.com/watch?v='+encodeURIComponent(target.remoteId)} target="_blank" rel="noopener noreferrer">Review on YouTube</a>}{canRetryPublishingTarget(target)&&<button type="button" disabled={busy||!currentStatus.connected} onClick={()=>void act(async signal=>{await publishingRequest(api,'/targets/'+encodeURIComponent(target.id)+'/retry',signal,{});})}>Retry destination</button>}</div>)}</article>)}
      {currentStatus&&!currentStatus.jobs.length&&<p>No publishing jobs yet.</p>}
     </section>
    </div>

    <aside className="onece-multi-preview" aria-label="Media preview">
     <h2>Preview</h2>
     <div className="onece-multi-preview-items">
      {previewFormats.map(format=>
       <div className="onece-multi-preview-item" key={format.id}>
        <div className={'onece-multi-preview-frame '+format.id}>
         {video&&visualUrl?<video src={visualUrl} controls playsInline muted={videoAudioMode==='replace'}/>:
          image&&visualUrl?<img src={visualUrl} alt="Selected cover preview"/>:
          <span><ImagePlus size={28}/>No media selected</span>}
        </div>
        <span>{youtubeSelected?'YouTube '+format.ratio+' preview':'Media preview'}</span>
       </div>)}
     </div>
     {audioFile&&<div className="onece-multi-audio-preview">
      <Music2 size={15}/><span>{audioFile.name}</span>
      {(!video||videoAudioMode==='replace')&&audioUrl&&<audio controls preload="none" src={audioUrl} aria-label="Selected audio preview"/>}
     </div>}
     {video&&videoAudioMode==='replace'&&<p className="onece-multi-hint">Replacement audio is previewed separately until the v2 video renderer is ready.</p>}
     <p className="onece-multi-preview-note">YouTube image + audio is rendered by the server. Other combinations remain previews.</p>
    </aside>
   </div>
  </section>
 );
}
