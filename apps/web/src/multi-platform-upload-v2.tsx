import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,Check,ChevronDown,ChevronUp,Globe2,ImagePlus,Instagram,MessageCircle,MoreHorizontal,Music2,Send,UploadCloud,Video,Youtube} from 'lucide-react';
import './multi-platform-upload-v2.css';
import {publishingRequest,publishingAuthorizationUrl,canRetryPublishingTarget,publishingErrorMessage,type PublishingStatus,type PublishingPayload} from './publishing-api-v2';
import {uploadPublishingFile} from './upload-file-v2';
import {beginAnotherPublishingRequest,reconcilePublishingRequestIds,requestIdForPublishingIntent} from './publishing-idempotency-v2';

type Platform='YouTube'|'TikTok'|'Instagram'|'Telegram'|'Discord';
type Format='vertical'|'horizontal';
const platforms:Platform[]=['YouTube','Instagram','TikTok','Telegram','Discord'];
const formats:{id:Format;label:string;ratio:string}[]=[
 {id:'vertical',label:'Vertical',ratio:'9:16'},
 {id:'horizontal',label:'Horizontal',ratio:'16:9'}
];
type DestinationPickerProps={
 selected:Platform[];
 disabled:boolean;
 status:PublishingStatus|null;
 selectedYouTubeFormats:Format[];
 onToggleYouTubeFormat:(format:Format)=>void;
 onToggle:(platform:Platform)=>void;
 onConnection:(platform:'YouTube'|'Instagram')=>void;
};
// Same compact, anchored destination list used by the original 1CE upload.
// The popover lives outside the card overflow, with viewport-aware placement.
function DestinationSymbol({platform}:{platform:Platform}){
 if(platform==='YouTube')return <Youtube size={17}/>;
 if(platform==='Instagram')return <Instagram size={17}/>;
 if(platform==='TikTok')return <Music2 size={17}/>;
 if(platform==='Telegram')return <Send size={17}/>;
 return <MessageCircle size={17}/>;
}
function DestinationPicker({selected,disabled,status,selectedYouTubeFormats,onToggleYouTubeFormat,onToggle,onConnection}:DestinationPickerProps){
 const [open,setOpen]=useState(false);
 const [youtubeFormatsOpen,setYoutubeFormatsOpen]=useState(false);
 const [position,setPosition]=useState<CSSProperties>({});
 const trigger=useRef<HTMLButtonElement|null>(null);
 const panel=useRef<HTMLDivElement|null>(null);
 const panelId=useId();
 const formatsId=useId();
 useEffect(()=>{if(!open)setYoutubeFormatsOpen(false)},[open]);
 useEffect(()=>{if(disabled)setOpen(false)},[disabled]);
 useLayoutEffect(()=>{
  if(!open)return;
  const place=()=>{
   const rect=trigger.current?.getBoundingClientRect();
   if(!rect)return;
   const width=Math.min(398,window.innerWidth-24);
   const below=window.innerHeight-rect.bottom-16;
   const above=rect.top-16;
   const useAbove=below<260&&above>below;
   setPosition({
    position:'fixed',width,
    left:Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12)),
    maxHeight:Math.max(140,Math.min(480,useAbove?above:below)),
    ...(useAbove?{bottom:window.innerHeight-rect.top+8,top:'auto'}:{top:rect.bottom+8,bottom:'auto'})
   });
  };
  place();
  window.addEventListener('resize',place);
  window.addEventListener('scroll',place,true);
  return()=>{
   window.removeEventListener('resize',place);
   window.removeEventListener('scroll',place,true);
  };
 },[open]);
 useEffect(()=>{
  if(!open)return;
  panel.current?.querySelector<HTMLButtonElement>('.onece-multi-destination-option:not(:disabled)')?.focus();
  const outside=(event:PointerEvent)=>{
   if(!panel.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setOpen(false);
  };
  const onEscape=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();setOpen(false);trigger.current?.focus();}
  };
  document.addEventListener('pointerdown',outside);
  document.addEventListener('keydown',onEscape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',onEscape);};
 },[open]);
 return <div className="onece-multi-destination-picker">
  <button ref={trigger} type="button" className="onece-multi-destination-trigger"
   disabled={disabled} aria-expanded={open} aria-controls={panelId}
   aria-label={'Destinations, '+selected.length+' selected'}
   onClick={()=>setOpen(value=>!value)}>
   <span>Destinations</span>
   <span className="onece-multi-destination-summary" aria-hidden="true">
    {platforms.filter(platform=>selected.includes(platform)).map(platform=>
     <span key={platform} title={platform}><DestinationSymbol platform={platform}/></span>)}
    {!selected.length&&<small>Choose platforms</small>}
   </span>
   {open?<ChevronUp size={16}/>:<ChevronDown size={16}/>}
  </button>
  {open&&createPortal(
   <div ref={panel} id={panelId} className="onece-multi-destination-popover" style={position}
    role="region" aria-label="Destinations">
    <div className="onece-multi-destination-popover-heading">
     <strong>Destinations</strong><span>{selected.length} selected</span>
    </div>
    <div className="onece-multi-destination-list" role="group" aria-label="Destination platforms">
     {platforms.map(platform=>{
      const youtube=platform==='YouTube',instagram=platform==='Instagram';
      const connected=youtube?!!status?.connected:instagram?!!status?.instagram?.connected:false;
      return <div className="onece-multi-destination-group" key={platform}>
       <div className="onece-multi-destination-row">
        <button type="button" className="onece-multi-destination-option"
         disabled={disabled} aria-pressed={selected.includes(platform)} onClick={()=>onToggle(platform)}>
         <span className="onece-multi-checkbox">{selected.includes(platform)&&<Check size={13}/>}</span>
         <DestinationSymbol platform={platform}/>
         <span className="onece-multi-destination-label"><strong>{platform}</strong>
          {(youtube||instagram)&&<small>{connected?'Connected':'Not connected'}</small>}
         </span>
        </button>
        {youtube&&<button type="button" className="onece-multi-destination-more"
         disabled={disabled} title="YouTube formats" aria-label="YouTube formats"
         aria-controls={formatsId} aria-expanded={youtubeFormatsOpen}
         onClick={()=>setYoutubeFormatsOpen(value=>!value)}>
         <MoreHorizontal size={18}/>
        </button>}
        {(youtube||instagram)&&<button type="button" className="onece-multi-destination-account"
         disabled={disabled||!status||(instagram&&!status.instagram?.available)}
         onClick={()=>onConnection(platform)}>
         {connected?'Disconnect':'Connect'}
        </button>}
       </div>
       {youtube&&youtubeFormatsOpen&&<div id={formatsId} className="onece-multi-youtube-formats"
        role="group" aria-label="YouTube video formats">
        {formats.map(format=><button type="button" key={format.id}
         disabled={disabled} aria-pressed={selectedYouTubeFormats.includes(format.id)}
         onClick={()=>onToggleYouTubeFormat(format.id)}>
         <span className="onece-multi-checkbox">{selectedYouTubeFormats.includes(format.id)&&<Check size={12}/>}</span>
         <span>{format.id==='vertical'?'Shorts 9:16':'Standard 16:9'}</span>
        </button>)}
       </div>}
      </div>;
     })}
    </div>
   </div>,document.body)}
 </div>;
}

const publicationState=(state:string)=>({draft:'Draft',queued:'Queued',running:'Rendering or uploading',retryable:'Waiting to retry',succeeded:'Uploaded',failed:'Failed',needs_review:'Needs review',cancelled:'Cancelled'}[state]||'Updating');

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
 const [accepted,setAccepted]=useState(false);
 const [notice,setNotice]=useState('');
 const [failure,setFailure]=useState('');
 const [revision,setRevision]=useState(0);
 const operation=useRef<AbortController|null>(null);
 const pending=useRef<PublishingPayload|null>(null);
 const viewer=useRef(userId);viewer.current=userId;
 useEffect(()=>{pending.current=null;setAccepted(false);},[title,description,hashtags,privacy,audioFile,image,video,selectedPlatforms,selectedYouTubeFormats]);
 useEffect(()=>{
  operation.current?.abort();operation.current=null;pending.current=null;
  setStatus(null);setBusy(false);setAccepted(false);setNotice('');setFailure('');
  setAudio(null);setVisual(null);setVideo(null);setTitle(initialTitle);setDescription('');setHashtags('#shorts #music');setPrivacy('private');setSelectedPlatforms([]);setSelectedYouTubeFormats(['vertical']);
  return()=>{operation.current?.abort();};
 },[userId]);
 useEffect(()=>{
  const result=new URLSearchParams(window.location.search).get('publishing');
  if(result==='youtube-connected')setNotice('YouTube connected. Choose media and confirm a submission.');
  if(result==='youtube-error')setFailure('YouTube connection was not completed. Grant both requested permissions and confirm that the YouTube API is enabled for the app.');
  if(result==='instagram-connected')setNotice('Instagram account connected successfully.');
  if(result==='instagram-error'){
   const reason=new URLSearchParams(window.location.search).get('reason');
   setFailure(publishingErrorMessage(reason||'instagram_authorization_failed'));
  }
 },[userId]);
 useEffect(()=>{
  if(!active||!userId)return;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   try{
    const value=await publishingRequest<PublishingStatus>(api,'/status',controller.signal);
    if(!controller.signal.aborted){
     reconcilePublishingRequestIds(userId,value.jobs.flatMap(job=>job.requestId?[job.requestId]:[]));
     setStatus({viewer:userId,value});
    }
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
  const selectedYoutube=selectedPlatforms.includes('YouTube'),selectedInstagram=selectedPlatforms.includes('Instagram');
  if(!userId||accepted||video||!audioFile||!image||!title.trim()||!selectedPlatforms.length||
   selectedPlatforms.some(p=>p!=='YouTube'&&p!=='Instagram')||
   (selectedYoutube&&(!currentStatus?.available||!currentStatus.connected))||
   (selectedInstagram&&(!currentStatus?.instagram?.publishingEnabled||
     !currentStatus.instagram.connected)))return;
  if(!pending.current){
   setNotice('Uploading audio…');const audioFileId=await uploadPublishingFile(api,audioFile,'audio',signal,setNotice);
   signal.throwIfAborted();setNotice('Uploading image…');const coverFileId=await uploadPublishingFile(api,image,'cover',signal,setNotice);
   signal.throwIfAborted();
   const targets:PublishingPayload['targets']=[];
   if(selectedYoutube)for(const format of selectedYouTubeFormats)
    targets.push({platform:'youtube',variant:format==='vertical'?'shorts':'standard'});
   if(selectedInstagram)targets.push({platform:'instagram',variant:'default'});
   const intent={title:title.trim(),description,hashtags,privacy,audioFileId,coverFileId,targets,
    ...(selectedInstagram?{instagramPublicConsent:true}:{})};
   const requestId=await requestIdForPublishingIntent(userId,intent);
   signal.throwIfAborted();
   pending.current={requestId,...intent};
  }
  setNotice('Submitting to queue…');
  await publishingRequest<{id:string;state:string}>(api,'/jobs',signal,pending.current);
  signal.throwIfAborted();
  reconcilePublishingRequestIds(userId,[pending.current.requestId]);
  setAccepted(true);setNotice('Accepted by the publishing queue. You can close this page; the server continues. Follow progress below.');
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
 const manageDestination=(platform:'YouTube'|'Instagram')=>void act(async signal=>{
  if(platform==='YouTube'){
   if(currentStatus?.connected){
    await publishingRequest(api,'/youtube/disconnect',signal,{});
    signal.throwIfAborted();setStatus(null);
   }else{
    const result=await publishingRequest<{url:string}>(api,'/youtube/connect',signal,{});
    signal.throwIfAborted();window.location.assign(publishingAuthorizationUrl(api,result.url));
   }
  }else{
   if(currentStatus?.instagram?.connected){
    await publishingRequest(api,'/instagram/disconnect',signal,{});
    signal.throwIfAborted();setStatus(null);
   }else{
    const result=await publishingRequest<{url:string}>(api,'/instagram/connect',signal,{});
    signal.throwIfAborted();window.location.assign(publishingAuthorizationUrl(api,result.url));
   }
  }
 });
 const toggleYouTubeFormat=(format:Format)=>{
  setSelectedYouTubeFormats(current=>current.includes(format)
   ?(current.length===1?current:current.filter(item=>item!==format))
   :[...current,format]);
 };
 const youtubeSelected=selectedPlatforms.includes('YouTube');
 const instagramSelected=selectedPlatforms.includes('Instagram');
 const youtubeReady=!youtubeSelected||!!(currentStatus?.available&&currentStatus.connected);
 const instagramReady=!instagramSelected||!!(currentStatus?.instagram?.connected&&currentStatus.instagram.publishingEnabled);
 const destinationsValid=selectedPlatforms.length>0&&selectedPlatforms.every(p=>p==='YouTube'||p==='Instagram');
 const previewFormats=youtubeSelected
  ? formats.filter(format=>selectedYouTubeFormats.includes(format.id)).reverse()
  : formats.filter(format=>format.id==='vertical');

 return (
  <section className="onece-multi-upload" aria-label="1CE Upload" hidden={!active}>
   <header className="onece-multi-heading">
    <button type="button" className="onece-multi-back" onClick={onBack}>
     <ArrowLeft size={18}/> Back to Home upload
    </button>
    <div className="onece-multi-title"><Globe2 size={22}/><h1>1CE Upload</h1></div>
    <p>Prepare one upload for multiple platforms. Inspired by the original 1CE workflow.</p>
    {!currentStatus?.connected&&!currentStatus?.instagram?.connected&&<p>Connect a destination to start publishing.</p>}
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
      <label>Description<textarea rows={3} maxLength={2000} value={description} onChange={event=>setDescription(event.target.value)} placeholder="Description shown on platforms"/></label>
      <label>Hashtags<input maxLength={500} value={hashtags} onChange={event=>setHashtags(event.target.value)} placeholder="#music #beats"/></label>
      {youtubeSelected&&<label>YouTube visibility<select value={privacy} onChange={event=>setPrivacy(event.target.value as PublishingPayload['privacy'])}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label>}
     </div>

     <div className="onece-multi-panel onece-multi-destinations-panel">
      <DestinationPicker selected={selectedPlatforms} disabled={busy||!active}
       status={currentStatus} selectedYouTubeFormats={selectedYouTubeFormats}
       onToggleYouTubeFormat={toggleYouTubeFormat}
       onToggle={togglePlatform} onConnection={manageDestination}/>
     </div>
     </fieldset>
     <div className="onece-multi-publish">
      <button type="button" onClick={submit} disabled={accepted||busy||!active||!userId||!audioFile||!image||!!video||!title.trim()||!destinationsValid||!youtubeReady||!instagramReady}>{accepted?'Submitted — see history':
       youtubeSelected&&instagramSelected?'Publish to YouTube + public Instagram Reel':instagramSelected?'Publish public Instagram Reel':'Publish to YouTube'}</button>
      {notice&&<p role="status">{notice}</p>}{failure&&<p role="alert">{failure}</p>}
      {video&&<p>Original video publishing is unavailable. Choose an image and MP3/WAV audio.</p>}
      {instagramSelected&&!currentStatus?.instagram?.publishingEnabled&&<p>Instagram account connected, but public Reels publishing is not enabled on this server yet. You can submit YouTube-only jobs.</p>}
      {selectedPlatforms.some(platform=>platform!=='YouTube'&&platform!=='Instagram')&&<p>Other destinations are previews only. Remove them before publishing.</p>}
      {accepted&&<button type="button" disabled={busy} onClick={()=>{
       if(!userId||!pending.current)return;
       try{beginAnotherPublishingRequest(userId,pending.current.requestId);pending.current=null;setAccepted(false);setNotice('Ready for another publication. Submitting again creates a new job.');}
       catch(error){setFailure(error instanceof Error?error.message:'Unable to start another publication');}
      }}>Start another publication</button>}
      <p>After an uncertain submit error or reload, submit the same media and details to recover the existing request. An accepted job is not yet a published video.</p>
     </div>
     <section className="onece-multi-panel" aria-label="Publishing history"><h2>Publishing history</h2>
      {currentStatus?.jobs.map(job=><article key={job.id}><h3>{job.title}</h3><p>{publicationState(job.state)}</p>{job.targets.map(target=><div key={target.id}><span>{target.platform} · {target.variant==='shorts'?'Shorts 9:16':target.variant==='standard'?'Standard 16:9':target.variant} · {publicationState(target.state)}{target.errorCode?' · '+publishingErrorMessage(target.errorCode):''}</span>{target.remoteId&&target.platform==='youtube'&&<a href={'https://www.youtube.com/watch?v='+encodeURIComponent(target.remoteId)} target="_blank" rel="noopener noreferrer">Review on YouTube</a>}{canRetryPublishingTarget(target)&&<button type="button" disabled={busy||(target.platform==='instagram'?!currentStatus.instagram?.publishingEnabled:!currentStatus.connected)} onClick={()=>void act(async signal=>{await publishingRequest(api,'/targets/'+encodeURIComponent(target.id)+'/retry',signal,{});})}>Retry destination</button>}</div>)}</article>)}
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
