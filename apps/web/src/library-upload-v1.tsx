// Visual/interaction port of v1 src/upload/LibraryUploadPage.jsx.
// NO v1 backend, bearer session, uploads or external video publishing.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import './library-upload-v1.css';
import {notifyV2DataChanged} from './data-refresh-v2';
const audioPattern=/\.(mp3|wav)$/i;
const fileTitle=(file:File)=>file.name.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').trim();
const formatSize=(file:File)=>(file.size/1024/1024).toFixed(2)+' MB';
export default function LibraryUploadV2({userId}:{userId?:number}={}){
 const navigate=useNavigate();
 const [audioFiles,setAudioFiles]=useState<File[]>([]);
 const [cover,setCover]=useState<File|null>(null);
 const [stemsByAudio,setStemsByAudio]=useState<Record<string,File>>({});
 const [itemName,setItemName]=useState('');
 const [dragging,setDragging]=useState(false);
 const [error,setError]=useState('');
 const audioInput=useRef<HTMLInputElement|null>(null);
 const coverInput=useRef<HTMLInputElement|null>(null);
 const stemsInput=useRef<HTMLInputElement|null>(null);
 const [stemsTarget,setStemsTarget]=useState<string|null>(null);
 const [saving,setSaving]=useState(false);
 const [stage,setStage]=useState('');
 const isPack=audioFiles.length>1;
 const coverUrl=useMemo(()=>cover?URL.createObjectURL(cover):'',[cover]);
 useEffect(()=>()=>{if(coverUrl)URL.revokeObjectURL(coverUrl)},[coverUrl]);
 const addFiles=(selected:FileList|File[]|null)=>{
  const valid:File[]=[],invalid:File[]=[];
  for(const file of selected||[]){if(audioPattern.test(file.name))valid.push(file);else invalid.push(file)}
  setError(invalid.length?invalid.length+' file(s) skipped. Use MP3 or WAV audio.':'');
  if(!valid.length)return;
  setAudioFiles(current=>{const known=new Set(current.map(file=>file.name+':'+file.size));return [...current,...valid.filter(file=>!known.has(file.name+':'+file.size))]});
  if(!itemName&&valid.length===1)setItemName(fileTitle(valid[0]));
 };
 const fileKey=(file:File)=>file.name+':'+file.size;
 const removeFile=(file:File)=>{setAudioFiles(current=>current.filter(item=>item!==file));setStemsByAudio(current=>{const next={...current};delete next[fileKey(file)];return next;});setError('')};
 const chooseStems=(file:File)=>{setStemsTarget(fileKey(file));stemsInput.current?.click()};
 const save=async()=>{
  if(saving||!audioFiles.length)return;
  const api=import.meta.env.VITE_API_URL;
  if(!api){setError('Upload API is not configured');return;}
  setSaving(true);setError('');
  const upload=async(file:File,kind:'audio'|'cover'|'stems'):Promise<number>=>{
   const mime=kind==='audio'?(file.name.toLowerCase().endsWith('.mp3')?'audio/mpeg':'audio/wav'):
    kind==='stems'?'application/zip':file.type;
   setStage('Checking existing '+kind+'…');
   const bytes=await file.arrayBuffer();
   const digest=await crypto.subtle.digest('SHA-256',bytes);
   const sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
   const response=await fetch(api+'/api/library/files/init',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,name:file.name,contentType:mime,size:file.size,sha256})});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(data.error||'Unable to start upload');
   if(data.reused)return Number(data.id);
   const put=await fetch(data.uploadUrl,{method:'PUT',headers:{'Content-Type':mime},body:file});
   if(!put.ok)throw new Error('Storage upload failed ('+put.status+'). Check R2 CORS settings.');
   const done=await fetch(api+'/api/library/files/'+data.id+'/complete',{method:'POST',credentials:'include'});
   const completion=await done.json().catch(()=>({}));
   if(!done.ok)throw new Error(completion.error||'Unable to finalize upload');
   return Number(completion.id);
  };
  try{
   let coverId=null;
   if(cover){setStage('Uploading shared cover…');coverId=await upload(cover,'cover');}
   const beatIds:string[]=[];
   const newBeatIds:string[]=[];
   for(const [index,file] of audioFiles.entries()){
    setStage('Uploading audio '+(index+1)+'/'+audioFiles.length+'…');
    const audioId=await upload(file,'audio');
    const stems=stemsByAudio[fileKey(file)];
    let stemsId=null;
    if(stems){setStage('Uploading stems for '+file.name+'…');stemsId=await upload(stems,'stems');}
    const beatResponse=await fetch(api+'/api/library/files/beats',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:isPack?fileTitle(file):itemName.trim()||fileTitle(file),audioFileId:audioId,coverFileId:isPack?null:coverId,stemsFileId:stemsId})});
    const beat=await beatResponse.json().catch(()=>({}));
    if(!beatResponse.ok)throw new Error(beat.error||'Unable to save beat');
    beatIds.push(beat.id);
    if(!beat.reused)newBeatIds.push(beat.id);
   }
   if(isPack){
    setStage('Creating pack…');
    const packResponse=await fetch(api+'/api/library/files/packs',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:itemName.trim()||'New pack',coverFileId:coverId,beatIds,newBeatIds})});
    const pack=await packResponse.json().catch(()=>({}));
    if(!packResponse.ok)throw new Error(pack.error||'Unable to create pack');
   }
   setAudioFiles([]);setCover(null);setStemsByAudio({});setItemName('');
   notifyV2DataChanged(['library'],userId);
   navigate('/app/library',{replace:true});
  }catch(e){setError(e instanceof Error?e.message:'Upload failed');}
  finally{setSaving(false);setStage('');}
 };
   return (
    <section className="library-upload" aria-label="Upload audio">
      <div className="library-upload-card">
        <header className="library-upload-heading">
          <div>
            <h1>{isPack ? 'Create pack' : 'Add file'}</h1>
            <p>
              {audioFiles.length
                ? (isPack
                  ? audioFiles.length + ' audio files will be saved as a pack.'
                  : 'One audio file will be saved as a beat.')
                : 'Add one or more MP3 or WAV files.'}
            </p>
          </div>
        </header>

        <div className="library-upload-grid">
          <div className="library-upload-cover">
            <button
              type="button"
              className={'upload-cover-drop' + (dragging ? ' is-dragging' : '')}
              onClick={() => coverInput.current?.click()}
              onDragOver={event => { event.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={event => {
                event.preventDefault()
                setDragging(false)
                const file = event.dataTransfer.files?.[0]
                if (file && /image\//.test(file.type)) setCover(file)
              }}
            >
              {coverUrl
                ? <img src={coverUrl} alt="Cover preview" />
                : <span className="upload-cover-placeholder">Add cover</span>}
            </button>
            <input
              ref={coverInput}
              type="file"
              accept="image/*"
              hidden
              onChange={event => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) setCover(file)
              }}
            />
            {cover && (
              <button type="button" className="upload-secondary-action" onClick={() => setCover(null)}>
                Remove cover
              </button>
            )}
          </div>

          <div className="library-upload-form">
            <button
              type="button"
              className={'upload-audio-drop' + (dragging ? ' is-dragging' : '')}
              onClick={() => audioInput.current?.click()}
              onDragOver={event => { event.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={event => {
                event.preventDefault()
                setDragging(false)
                addFiles(event.dataTransfer.files)
              }}
            >
              <strong>{audioFiles.length ? 'Add more audio' : 'Drop MP3 or WAV files'}</strong>
              <span>Select one file for a beat, or several files for a pack.</span>
            </button>
            <input
              ref={audioInput}
              type="file"
              accept=".mp3,.wav"
              multiple
              hidden
              onChange={event => {
                addFiles(event.target.files)
                event.target.value = ''
              }}
            />

            {audioFiles.length > 0 && (
              <ul className="upload-file-list">
                {audioFiles.map(file => (
                  <li key={file.name + ':' + file.size}>
                    <div>
                      <strong>{file.name}</strong>
                      <span>{formatSize(file)}</span>
                    </div>
                    <div className="upload-file-actions">
                      <button type="button" disabled={saving} onClick={()=>chooseStems(file)}>
                        {stemsByAudio[fileKey(file)] ? 'Stems: '+stemsByAudio[fileKey(file)].name : 'Add stems'}
                      </button>
                    <button
                      type="button"
                      aria-label={'Remove ' + file.name}
                      disabled={saving}
                      onClick={() => removeFile(file)}
                    >
                      Remove
                    </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <label className="upload-field">
              <span>{isPack ? 'Pack name' : 'Beat title'}</span>
              <input
                type="text"
                value={itemName}
                placeholder={isPack ? 'New pack' : 'Beat title'}
                onChange={event => setItemName(event.target.value)}
              />
            </label>

            <input ref={stemsInput} type="file" accept=".zip" hidden onChange={event=>{
              const file=event.target.files?.[0];event.target.value='';
              if(file&&stemsTarget){
               if(!/\.zip$/i.test(file.name)){setError('Stems must be a ZIP file');return;}
               setStemsByAudio(current=>({...current,[stemsTarget]:file}));
              }
            }}/>

            {error && <p className="upload-error" role="alert">{error}</p>}
            {stage && <p className="upload-stage" role="status">{stage}</p>}


            <div className="upload-actions">
              <button
                type="button"
                className="upload-primary-action"
                disabled={!audioFiles.length || saving}
                onClick={save}
              >
                {saving ? "Saving…" : "Save to Home"}
              </button>
              {!isPack && audioFiles.length === 1 && (
                <button
                  type="button"
                  className="upload-secondary-action"
                  disabled
                  title="Video creation is coming soon"
                >
                  Create video
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
