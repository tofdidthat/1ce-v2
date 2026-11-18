import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,Check,ChevronDown,ChevronUp,Globe2,ImagePlus,Instagram,MessageCircle,MoreHorizontal,Music2,Send,UploadCloud,Video,Youtube} from 'lucide-react';
import './multi-platform-upload-v2.css';
import {publishingRequest,publishingAuthorizationUrl,canRetryPublishingTarget,publishingErrorMessage,type PublishingStatus,type PublishingPayload} from './publishing-api-v2';
import {tiktokDraftForSubmission,tikTokMinDuration,tikTokMaxDuration} from './tiktok-draft-v2';
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
 onConnection:(platform:'YouTube'|'Instagram'|'TikTok')=>void;
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
      const youtube=platform==='YouTube',instagram=platform==='Instagram',tiktok=platform==='TikTok';
      const connected=youtube?!!status?.connected:instagram?!!status?.instagram?.connected:
       tiktok?!!status?.tiktok?.connected:false;
      return <div className="onece-multi-destination-group" key={platform}>
       <div className="onece-multi-destination-row">
        <button type="button" className="onece-multi-destination-option"
         disabled={disabled} aria-pressed={selected.includes(platform)} onClick={()=>onToggle(platform)}>
         <span className="onece-multi-checkbox">{selected.includes(platform)&&<Check size={13}/>}</span>
         <DestinationSymbol platform={platform}/>
         <span className="onece-multi-destination-label"><strong>{platform}</strong>
          {(youtube||instagram)&&<small>{connected?'Connected':'Not connected'}</small>}
          {tiktok&&<small>{connected?(status?.tiktok?.nickname||'Connected'):
           status?.tiktok?.available?'Not connected':'Unavailable'}</small>}
         </span>
        </button>
        {youtube&&<button type="button" className="onece-multi-destination-more"
         disabled={disabled} title="YouTube formats" aria-label="YouTube formats"
         aria-controls={formatsId} aria-expanded={youtubeFormatsOpen}
         onClick={()=>setYoutubeFormatsOpen(value=>!value)}>
         <MoreHorizontal size={18}/>
        </button>}
        {(youtube||instagram||tiktok)&&<button type="button" className="onece-multi-destination-account"
         disabled={disabled||!status||(instagram&&!status.instagram?.available)||
          (tiktok&&!status.tiktok?.available)}
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
 const tiktokSelected=selectedPlatforms.includes('TikTok');
 const tiktokStatus=currentStatus?.tiktok;
 const tiktokConnectionId=tiktokStatus?.available&&tiktokStatus.connected&&tiktokStatus.publishingEnabled?
  tiktokStatus.connectionId:null;
 const [durationByFile,setDurationByFile]=useState<{file:File;seconds:number}|null>(null);
 const duration=durationByFile&&durationByFile.file===audioFile?durationByFile.seconds:null;
 const consentScope=useMemo(()=>({userId,tiktokConnectionId,audioFile,image}),[userId,tiktokConnectionId,audioFile,image]);
 const [consentedScope,setConsentedScope]=useState<typeof consentScope|null>(null);
 const tiktokConsent=consentedScope===consentScope;
 const tiktokDraft=tiktokDraftForSubmission(tiktokConnectionId,duration,tiktokConsent);
 const tiktokReady=!tiktokSelected||!!tiktokDraft;
 const operation=useRef<AbortController|null>(null);
 const pending=useRef<PublishingPayload|null>(null);
 const viewer=useRef(userId);viewer.current=userId;
 useEffect(()=>{pending.current=null;setAccepted(false);},[title,description,hashtags,privacy,audioFile,image,video,selectedPlatforms,selectedYouTubeFormats]);
 useEffect(()=>{
  operation.current?.abort();operation.current=null;pending.current=null;
  setConsentedScope(null);
  setStatus(null);setBusy(false);setAccepted(false);setNotice('');setFailure('');
  setAudio(null);setVisual(null);setVideo(null);setTitle(initialTitle);setDescription('');setHashtags('#shorts #music');setPrivacy('private');setSelectedPlatforms([]);setSelectedYouTubeFormats(['vertical']);
  return()=>{operation.current?.abort();};
 },[userId]);
 useEffect(()=>{
  const result=new URLSearchParams(window.location.search).get('publishing');
  if(result==='youtube-connected')setNotice('YouTube connected. Choose media and confirm a submission.');
  if(result==='youtube-error')setFailure('YouTube connection was not completed. Grant both requested permissions and confirm that the YouTube API is enabled for the app.');
  if(result==='instagram-connected')setNotice('Instagram account connected successfully.');
  if(result==='tiktok-connected')setNotice('TikTok account connected successfully.');
  if(result==='tiktok-error')setFailure(publishingErrorMessage(new URLSearchParams(window.location.search).get('reason')||'tiktok_authorization_failed'));
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
 const youtubeSelected=selectedPlatforms.includes('YouTube');
 const instagramSelected=selectedPlatforms.includes('Instagram');
 const youtubeReady=!youtubeSelected||!!(currentStatus?.available&&currentStatus.connected);
 const instagramReady=!instagramSelected||!!(currentStatus?.instagram?.connected&&currentStatus.instagram.publishingEnabled);
 const destinationsValid=selectedPlatforms.length>0&&selectedPlatforms.every(p=>p==='YouTube'||p==='Instagram'||p==='TikTok');
 const act=async(task:(signal:AbortSignal)=>Promise<void>)=>{
  if(operation.current||!userId||!active)return;
  const controller=new AbortController(),account=userId;operation.current=controller;setBusy(true);setFailure('');setNotice('');
  try{await task(controller.signal);if(!controller.signal.aborted&&viewer.current===account)setRevision(v=>v+1);}
  catch(error){if(!controller.signal.aborted&&viewer.current===account)setFailure(error instanceof Error?error.message:'Publishing failed');}
  finally{if(operation.current===controller){operation.current=null;setBusy(false);}}
 };
 const submit=()=>void act(async signal=>{
  if(!userId||accepted||video||!audioFile||!image||!title.trim()||
   !destinationsValid||!youtubeReady||!instagramReady||!tiktokReady)return;
  if(pending.current?.tiktok?.connectionId!==tiktokDraft?.connectionId)pending.current=null;
  if(!pending.current){
   setNotice('Uploading audio…');const audioFileId=await uploadPublishingFile(api,audioFile,'audio',signal,setNotice);
   signal.throwIfAborted();setNotice('Uploading image…');const coverFileId=await uploadPublishingFile(api,image,'cover',signal,setNotice);
   signal.throwIfAborted();
   const targets:PublishingPayload['targets']=[];
   if(youtubeSelected)for(const format of selectedYouTubeFormats)
    targets.push({platform:'youtube',variant:format==='vertical'?'shorts':'standard'});
   if(instagramSelected)targets.push({platform:'instagram',variant:'default'});
   if(tiktokSelected&&tiktokDraft)targets.push({platform:'tiktok',variant:'default'});
   const intent={title:title.trim(),description,hashtags,privacy,audioFileId,coverFileId,targets,
    ...(instagramSelected?{instagramPublicConsent:true}:{}),...(tiktokSelected&&tiktokDraft?{tiktok:tiktokDraft}:{})};
   const requestId=await requestIdForPublishingIntent(userId,intent);
   signal.throwIfAborted();
   pending.current={requestId,...intent};
  }
  setNotice('Submitting to queue…');
  const submission=pending.current;
  await publishingRequest<{id:string;state:string}>(api,'/jobs',signal,submission);
  signal.throwIfAborted();
  reconcilePublishingRequestIds(userId,[submission.requestId]);
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
  if(platform==='TikTok')setConsentedScope(null);
  setSelectedPlatforms(current=>current.includes(platform)?current.filter(item=>item!==platform):[...current,platform]);
 };
 const manageDestination=(platform:'YouTube'|'Instagram'|'TikTok')=>void act(async signal=>{
  if(platform==='YouTube'){
   if(currentStatus?.connected){
    await publishingRequest(api,'/youtube/disconnect',signal,{});
    signal.throwIfAborted();setStatus(null);
   }else{
    const result=await publishingRequest<{url:string}>(api,'/youtube/connect',signal,{});
    signal.throwIfAborted();window.location.assign(publishingAuthorizationUrl(api,result.url));
   }
  }else if(platform==='Instagram'){
   if(currentStatus?.instagram?.connected){
    await publishingRequest(api,'/instagram/disconnect',signal,{});
    signal.throwIfAborted();setStatus(null);
   }else{
    const result=await publishingRequest<{url:string}>(api,'/instagram/connect',signal,{});
    signal.throwIfAborted();window.location.assign(publishingAuthorizationUrl(api,result.url));
   }
  }else{
   if(currentStatus?.tiktok?.connected){
    const result=await publishingRequest<{providerRevoked:boolean}>(api,'/tiktok/disconnect',signal,{});
    signal.throwIfAborted();setStatus(null);setConsentedScope(null);
    setSelectedPlatforms(current=>current.filter(item=>item!=='TikTok'));
    setNotice(result.providerRevoked?'TikTok disconnected.':
     'Disconnected locally. TikTok did not confirm revocation. Remove 1CE in TikTok connected apps as well.');
   }else{
    const result=await publishingRequest<{url:string}>(api,'/tiktok/connect',signal,{});
    signal.throwIfAborted();window.location.assign(publishingAuthorizationUrl(api,result.url));
   }
  }
 });
 const toggleYouTubeFormat=(format:Format)=>{
  setSelectedYouTubeFormats(current=>current.includes(format)
   ?(current.length===1?current:current.filter(item=>item!==format))
   :[...current,format]);
 };
 const acceptedTikTokTarget=currentStatus?.jobs.find(job=>job.requestId===pending.current?.requestId)
  ?.targets.find(target=>target.platform==='tiktok');
 const canStartAnother=!tiktokSelected||['succeeded','failed','cancelled'].includes(acceptedTikTokTarget?.state||'');
 const youtubePreviewFormats=youtubeSelected
  ? formats.filter(format=>selectedYouTubeFormats.includes(format.id)).reverse()
  : formats.filter(format=>format.id==='vertical');
 const tiktokExtraPreview=tiktokSelected&&youtubeSelected&&!selectedYouTubeFormats.includes('vertical')&&!!image;
 const previewFormats=tiktokExtraPreview?[...youtubePreviewFormats,formats[0]]:youtubePreviewFormats;

 return (
  <section className="onece-multi-upload" aria-label="1CE Upload" hidden={!active}>
   <header className="onece-multi-heading">
    <button type="button" className="onece-multi-back" onClick={onBack}>
     <ArrowLeft size={18}/> Back to Home upload
    </button>
    <div className="onece-multi-title"><Globe2 size={22}/><h1>1CE Upload</h1></div>
    <p>Prepare one upload for multiple platforms. Inspired by the original 1CE workflow.</p>
    {!currentStatus?.connected&&!currentStatus?.instagram?.connected&&!currentStatus?.tiktok?.connected&&<p>Connect a destination to start publishing.</p>}
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
     {tiktokSelected&&tiktokConnectionId&&<div className="onece-multi-panel onece-multi-metadata onece-multi-tiktok">
      <h2>TikTok draft</h2>
      {tiktokStatus?.nickname&&<p>Sending to {tiktokStatus.nickname}</p>}
      <p>Once the draft is sent, open the notification in your TikTok inbox to edit and publish the video.</p>
      {audioFile&&duration===null&&<p role="status">Checking audio length…</p>}
      {audioFile&&duration!==null&&!Number.isFinite(duration)&&<p>Unable to read the audio length. Choose a supported MP3 or WAV.</p>}
      {duration!==null&&Number.isFinite(duration)&&(duration<tikTokMinDuration||duration>tikTokMaxDuration)&&
       <p>Choose audio between {tikTokMinDuration} and {tikTokMaxDuration} seconds for TikTok.</p>}
      <label className="onece-multi-tiktok-consent">
       <input type="checkbox" checked={tiktokConsent} onChange={event=>setConsentedScope(event.target.checked?consentScope:null)}/>
       I agree to send this video to TikTok as a draft.
      </label>
     </div>}
     </fieldset>
     <div className="onece-multi-publish">
      <button type="button" onClick={submit} disabled={accepted||busy||!active||!userId||!audioFile||!image||!!video||!title.trim()||!destinationsValid||!youtubeReady||!instagramReady||!tiktokReady}>{accepted?'Submitted — see history':
       tiktokSelected&&!youtubeSelected&&!instagramSelected?'Send TikTok draft':
       (youtubeSelected&&instagramSelected?'Publish to YouTube + public Instagram Reel':
        instagramSelected?'Publish public Instagram Reel':'Publish to YouTube')+(tiktokSelected?' + send TikTok draft':'')}</button>
      {notice&&<p role="status">{notice}</p>}{failure&&<p role="alert">{failure}</p>}
      {video&&<p>Original video publishing is unavailable. Choose an image and MP3/WAV audio.</p>}
      {instagramSelected&&!currentStatus?.instagram?.publishingEnabled&&<p>Instagram account connected, but public Reels publishing is not enabled on this server yet. You can submit YouTube-only jobs.</p>}
      {tiktokSelected&&!tiktokStatus?.available&&<p>TikTok connection is unavailable.</p>}
      {tiktokSelected&&tiktokStatus?.available&&!tiktokStatus.connected&&<p>Connect TikTok in Destinations before sending a draft.</p>}
      {tiktokSelected&&tiktokStatus?.available&&tiktokStatus.connected&&!tiktokConnectionId&&<p>TikTok draft uploads are currently unavailable.</p>}
      {selectedPlatforms.some(platform=>platform!=='YouTube'&&platform!=='Instagram'&&platform!=='TikTok')&&<p>Other destinations are previews only. Remove them before publishing.</p>}
      {accepted&&canStartAnother&&<button type="button" disabled={busy} onClick={()=>{
       if(!userId||!pending.current)return;
       try{beginAnotherPublishingRequest(userId,pending.current.requestId);pending.current=null;setAccepted(false);setConsentedScope(null);setNotice('Ready for another publication. Submitting again creates a new job.');}
       catch(error){setFailure(error instanceof Error?error.message:'Unable to start another publication');}
      }}>Start another publication</button>}
      <p>After an uncertain submit error or reload, submit the same media and details to recover the existing request. An accepted job is not yet a published video.</p>
     </div>
     <section className="onece-multi-panel" aria-label="Publishing history"><h2>Publishing history</h2>
      {currentStatus?.jobs.map(job=><article key={job.id}>
       <h3>{job.title}</h3><p>{job.state==='succeeded'&&job.targets.some(target=>target.platform==='tiktok')?
        'Completed':publicationState(job.state)}</p>
       {job.targets.map(target=>{
        const tiktok=target.platform==='tiktok';
        const platform=tiktok?'TikTok':target.platform;
        const format=tiktok?'9:16':target.variant==='shorts'?'Shorts 9:16':
         target.variant==='standard'?'Standard 16:9':target.variant;
        const state=tiktok&&target.state==='succeeded'?'Draft sent':
         tiktok&&target.errorCode==='tiktok_processing'?'Processing on TikTok':publicationState(target.state);
        return <div key={target.id}>
         <span>{platform} · {format} · {state}
          {target.errorCode&&target.errorCode!=='tiktok_processing'?' · '+publishingErrorMessage(target.errorCode):''}</span>
         {tiktok&&target.state==='succeeded'&&<p>Open the notification in your TikTok inbox to edit and publish the video.</p>}
         {target.platform==='tiktok'&&target.state==='needs_review'&&<p>Check your TikTok inbox before sending this video again.</p>}
         {target.remoteId&&target.platform==='youtube'&&<a href={'https://www.youtube.com/watch?v='+encodeURIComponent(target.remoteId)}
          target="_blank" rel="noopener noreferrer">Review on YouTube</a>}
         {canRetryPublishingTarget(target)&&<button type="button"
          disabled={busy||(target.platform==='instagram'?!currentStatus.instagram?.publishingEnabled:!currentStatus.connected)}
          onClick={()=>void act(async signal=>{
           await publishingRequest(api,'/targets/'+encodeURIComponent(target.id)+'/retry',signal,{});
          })}>Retry destination</button>}
        </div>;
       })}
      </article>)}
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
        <span>{youtubeSelected?((tiktokSelected&&format.id==='vertical'?(tiktokExtraPreview?'TikTok ':'YouTube + TikTok '):'YouTube ')+format.ratio+' preview'):
         tiktokSelected?'TikTok 9:16 preview':'Media preview'}</span>
       </div>)}
     </div>
     {audioFile&&<div className="onece-multi-audio-preview">
      <Music2 size={15}/><span>{audioFile.name}</span>
      {(!video||videoAudioMode==='replace')&&audioUrl&&<audio key={audioUrl} controls preload={tiktokSelected?'metadata':'none'} src={audioUrl}
       onLoadedMetadata={event=>{if(audioFile)setDurationByFile({file:audioFile,seconds:event.currentTarget.duration});}}
       onDurationChange={event=>{if(audioFile)setDurationByFile({file:audioFile,seconds:event.currentTarget.duration});}}
       onError={()=>{if(audioFile)setDurationByFile({file:audioFile,seconds:NaN});}} aria-label="Selected audio preview"/>}
     </div>}
     {video&&videoAudioMode==='replace'&&<p className="onece-multi-hint">Replacement audio is previewed separately until the v2 video renderer is ready.</p>}
     <p className="onece-multi-preview-note">YouTube image + audio is rendered by the server. Other combinations remain previews.</p>
    </aside>
   </div>
  </section>
 );
}
