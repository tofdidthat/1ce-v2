// @ts-nocheck
// Visual/interaction port of v1 src/upload/LibraryUploadPage.jsx.
// NO v1 backend, bearer session, uploads or external video publishing.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import './library-upload-v1.css';
const audioPattern=/\.(mp3|wav)$/i;
const fileTitle=file=>file.name.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').trim();
const formatSize=file=>(file.size/1024/1024).toFixed(2)+' MB';
export default function LibraryUploadV2(){
 const [audioFiles,setAudioFiles]=useState([]);
 const [cover,setCover]=useState(null);
 const [stems,setStems]=useState(null);
 const [itemName,setItemName]=useState('');
 const [dragging,setDragging]=useState(false);
 const [error,setError]=useState('');
 const audioInput=useRef(null);
 const coverInput=useRef(null);
 const stemsInput=useRef(null);
 const [saving,setSaving]=useState(false);
 const [stage,setStage]=useState('');
 const [result,setResult]=useState('');
 const isPack=audioFiles.length>1;
 const coverUrl=useMemo(()=>cover?URL.createObjectURL(cover):'',[cover]);
 useEffect(()=>()=>{if(coverUrl)URL.revokeObjectURL(coverUrl)},[coverUrl]);
 const addFiles=selected=>{
  const valid=[],invalid=[];
  for(const file of selected||[]){if(audioPattern.test(file.name))valid.push(file);else invalid.push(file)}
  setError(invalid.length?invalid.length+' file(s) skipped. Use MP3 or WAV audio.':'');
  if(!valid.length)return;
  setAudioFiles(current=>{const known=new Set(current.map(file=>file.name+':'+file.size));return [...current,...valid.filter(file=>!known.has(file.name+':'+file.size))]});
  if(!itemName&&valid.length===1)setItemName(fileTitle(valid[0]));
 };
 const removeFile=file=>{setAudioFiles(current=>current.filter(item=>item!==file));setError('')};
 const save=async()=>{
  if(saving||!audioFiles.length)return;
  const api=import.meta.env.VITE_API_URL;
  if(!api){setError('Upload API is not configured');return;}
  setSaving(true);setError('');setResult('');
  const upload=async(file,kind)=>{
   const mime=kind==='audio'?(file.name.toLowerCase().endsWith('.mp3')?'audio/mpeg':'audio/wav'):
    kind==='stems'?'application/zip':file.type;
   const response=await fetch(api+'/api/library/files/init',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,name:file.name,contentType:mime,size:file.size})});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(data.error||'Unable to start upload');
   const put=await fetch(data.uploadUrl,{method:'PUT',headers:{'Content-Type':mime},body:file});
   if(!put.ok)throw new Error('Storage upload failed ('+put.status+'). Check R2 CORS settings.');
   const done=await fetch(api+'/api/library/files/'+data.id+'/complete',{method:'POST',credentials:'include'});
   const completion=await done.json().catch(()=>({}));
   if(!done.ok)throw new Error(completion.error||'Unable to finalize upload');
  };
  try{
   for(const [index,file] of audioFiles.entries()){
    setStage('Uploading audio '+(index+1)+'/'+audioFiles.length+'…');
    await upload(file,'audio');
   }
   if(cover){setStage('Uploading cover…');await upload(cover,'cover');}
   if(stems){setStage('Uploading stems…');await upload(stems,'stems');}
   setAudioFiles([]);setCover(null);setStems(null);setItemName('');
   setResult('Files saved to your private Library.');
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
                    <button
                      type="button"
                      aria-label={'Remove ' + file.name}
                      disabled={false}
                      onClick={() => removeFile(file)}
                    >
                      Remove
                    </button>
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

            {!isPack && audioFiles.length === 1 && (
              <div className="upload-stems">
                <button
                  type="button"
                  className="upload-secondary-action"
                  onClick={() => stemsInput.current?.click()}
                >
                  {stems ? stems.name : 'Add stems ZIP (optional)'}
                </button>
                <input
                  ref={stemsInput}
                  type="file"
                  accept=".zip"
                  hidden
                  onChange={event => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) setStems(file)
                  }}
                />
              </div>
            )}

            {error && <p className="upload-error" role="alert">{error}</p>}
            {stage && <p className="upload-stage" role="status">{stage}</p>}
            {result && <p className="upload-result" role="status">{result}</p>}


            <div className="upload-actions">
              <button
                type="button"
                className="upload-primary-action"
                disabled={!audioFiles.length || saving}
                onClick={save}
              >
                {saving ? "Saving…" : "Save to Library"}
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
