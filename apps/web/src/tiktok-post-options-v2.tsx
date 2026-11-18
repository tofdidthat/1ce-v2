import {
 tiktokInteractions,tiktokPrivacyLabels,tiktokSupportsBrandedContent,tikTokMinDuration,tikTokMaxDuration,
 type TikTokCreatorInfo,type TikTokDraft,type TikTokPrivacy
} from './tiktok-post-v2';

type Props={
 creator:TikTokCreatorInfo;
 draft:TikTokDraft;
 duration:number|null;
 hasAudio:boolean;
 consent:boolean;
 onChange:(draft:TikTokDraft)=>void;
 onConsent:(value:boolean)=>void;
};

export default function TikTokPostOptions({creator,draft,duration,hasAudio,consent,onChange,onConsent}:Props){
 const maxDuration=tikTokMaxDuration(creator);
 const brandedAvailable=creator.privacyLevelOptions.some(tiktokSupportsBrandedContent);
 const brandedDisabled=!brandedAvailable||!!(draft.privacyLevel&&!tiktokSupportsBrandedContent(draft.privacyLevel));
 return <div className="onece-multi-panel onece-multi-metadata onece-multi-tiktok">
  <h2>Post to TikTok</h2>
  <p>Posting to {creator.nickname}{creator.username?' (@'+creator.username+')':''}</p>
  <label>TikTok caption<textarea rows={2} maxLength={2200} value={draft.title}
   onChange={event=>onChange({...draft,title:event.target.value})}/></label>
  <label>TikTok privacy<select value={draft.privacyLevel} onChange={event=>
   onChange({...draft,privacyLevel:event.target.value as TikTokPrivacy|''})}>
   <option value="" disabled>Choose who can watch</option>
   {creator.privacyLevelOptions.map(option=><option key={option} value={option}
    disabled={draft.brandedContent&&!tiktokSupportsBrandedContent(option)}>{tiktokPrivacyLabels[option]}</option>)}
  </select></label>
  <div className="onece-multi-tiktok-checks" role="group" aria-label="TikTok interactions">
   {tiktokInteractions.map(({field,restriction,label})=><label key={field}>
    <input type="checkbox" disabled={creator[restriction]} checked={draft[field]&&!creator[restriction]}
     onChange={event=>onChange({...draft,[field]:event.target.checked})}/>{label}
   </label>)}
  </div>
  <div className="onece-multi-tiktok-checks" role="group" aria-label="TikTok commercial content disclosure">
   <label><input type="checkbox" checked={draft.discloseCommercial}
    onChange={event=>onChange({...draft,discloseCommercial:event.target.checked,ownBrand:false,brandedContent:false})}/>
    Disclose commercial content</label>
   {draft.discloseCommercial&&<>
    <label><input type="checkbox" checked={draft.ownBrand}
     onChange={event=>onChange({...draft,ownBrand:event.target.checked})}/>Your brand</label>
    <label><input type="checkbox" disabled={brandedDisabled} checked={draft.brandedContent}
     onChange={event=>onChange({...draft,brandedContent:event.target.checked})}/>Branded content</label>
   </>}
  </div>
  {draft.discloseCommercial&&brandedDisabled&&<p>Branded content requires Everyone or Friends visibility.</p>}
  {draft.discloseCommercial&&!draft.brandedContent&&!draft.ownBrand&&<p>Choose whose brand the video promotes.</p>}
  {draft.brandedContent?<p>TikTok will label this video Paid partnership.</p>:
   draft.ownBrand?<p>TikTok will label this video Promotional content.</p>:null}
  <p>Use audio between {tikTokMinDuration} and {maxDuration} seconds.</p>
  {hasAudio&&duration===null&&<p role="status">Checking audio length…</p>}
  {hasAudio&&duration!==null&&(duration<=0||!Number.isFinite(duration))&&<p>Unable to read the audio length. Choose a supported MP3 or WAV.</p>}
  {duration!==null&&duration>0&&duration<tikTokMinDuration&&<p>Choose a longer track for TikTok.</p>}
  {duration!==null&&Number.isFinite(duration)&&duration>maxDuration&&<p>Choose a shorter track for TikTok.</p>}
  <label className="onece-multi-tiktok-consent"><input type="checkbox" checked={consent}
   onChange={event=>onConsent(event.target.checked)}/>I agree to send this video to TikTok.</label>
  <p>By posting, you agree to TikTok’s {draft.brandedContent&&<>
   <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noopener noreferrer">Branded Content Policy</a> and </>}
   <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener noreferrer">Music Usage Confirmation</a>.
   TikTok may take a few minutes to process the video.</p>
 </div>;
}
