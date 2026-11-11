import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,Check,Globe2,ImagePlus,Music2,UploadCloud,Video} from 'lucide-react';
import './multi-platform-upload-v2.css';

type Platform='YouTube'|'TikTok'|'Instagram'|'Telegram'|'Discord';
type Format='vertical'|'horizontal';
const platforms:Platform[]=['YouTube','TikTok','Instagram','Telegram','Discord'];
const formats:{id:Format;label:string;ratio:string}[]=[
 {id:'vertical',label:'Vertical',ratio:'9:16'},
 {id:'horizontal',label:'Horizontal',ratio:'16:9'}
];

type Props={
 active:boolean;
 initialAudio:File|null;
 initialCover:File|null;
 initialTitle:string;
 onBack:()=>void;
};

export default function MultiPlatformUploadV2({active,initialAudio,initialCover,initialTitle,onBack}:Props){
 const [visual,setVisual]=useState<File|null>(null);
 const [video,setVideo]=useState<File|null>(null);
 const [audio,setAudio]=useState<File|null>(null);
 const [videoAudioMode,setVideoAudioMode]=useState<'original'|'replace'>('original');
 const [title,setTitle]=useState(initialTitle);
 const [description,setDescription]=useState('');
 const [hashtags,setHashtags]=useState('#shorts #music');
 const [selectedPlatforms,setSelectedPlatforms]=useState<Platform[]>([]);
 const [selectedFormats,setSelectedFormats]=useState<Format[]>(['vertical']);
 const visualInput=useRef<HTMLInputElement|null>(null);
 const audioInput=useRef<HTMLInputElement|null>(null);
 useEffect(()=>{if(initialTitle)setTitle(current=>current||initialTitle)},[initialTitle]);
 const image=video?null:(visual||initialCover);
 const audioFile=audio||initialAudio;
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
 const toggleFormat=(format:Format)=>{
  setSelectedFormats(current=>current.includes(format)
   ?(current.length===1?current:current.filter(item=>item!==format))
   :[...current,format]);
 };

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
      <p className="onece-multi-hint">Account connections and publishing are not yet enabled in 1CE v2.</p>
     </div>

     <div className="onece-multi-panel">
      <h2>Video formats</h2>
      <p className="onece-multi-hint">Choose vertical, horizontal, or both for supported platforms.</p>
      <div className="onece-multi-formats" role="group" aria-label="Video formats">
       {formats.map(format=><button type="button" key={format.id} aria-pressed={selectedFormats.includes(format.id)}
        onClick={()=>toggleFormat(format.id)}>
        <span className="onece-multi-checkbox">{selectedFormats.includes(format.id)&&<Check size={13}/>}</span>
        <span>{format.label}<small>{format.ratio}</small></span>
       </button>)}
      </div>
     </div>

     <div className="onece-multi-publish">
      <button type="button" disabled aria-label="Publishing to external platforms is coming soon">Publish to selected platforms</button>
      <p>Preview mode only. Nothing is sent to external platforms, and your Home upload stays unchanged.</p>
     </div>
    </div>

    <aside className="onece-multi-preview" aria-label="Media preview">
     <h2>Preview</h2>
     <div className="onece-multi-preview-items">
      {formats.filter(format=>selectedFormats.includes(format.id)).map(format=>
       <div className="onece-multi-preview-item" key={format.id}>
        <div className={'onece-multi-preview-frame '+format.id}>
         {video&&visualUrl?<video src={visualUrl} controls playsInline muted={videoAudioMode==='replace'}/>:
          image&&visualUrl?<img src={visualUrl} alt="Selected cover preview"/>:
          <span><ImagePlus size={28}/>No media selected</span>}
        </div>
        <span>{format.ratio} preview</span>
       </div>)}
     </div>
     {audioFile&&<div className="onece-multi-audio-preview">
      <Music2 size={15}/><span>{audioFile.name}</span>
      {(!video||videoAudioMode==='replace')&&audioUrl&&<audio controls preload="none" src={audioUrl} aria-label="Selected audio preview"/>}
     </div>}
     {video&&videoAudioMode==='replace'&&<p className="onece-multi-hint">Replacement audio is previewed separately until the v2 video renderer is ready.</p>}
     <p className="onece-multi-preview-note">Video creation, retries, and external publishing will be handled by the 1CE v2 website in a future integration.</p>
    </aside>
   </div>
  </section>
 );
}
