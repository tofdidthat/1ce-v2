export const tiktokPrivacyLabels={
 PUBLIC_TO_EVERYONE:'Everyone',
 MUTUAL_FOLLOW_FRIENDS:'Friends',
 FOLLOWER_OF_CREATOR:'Followers',
 SELF_ONLY:'Only you'
} as const;
export type TikTokPrivacy=keyof typeof tiktokPrivacyLabels;

export type TikTokCreatorInfo={
 connectionId:string;
 nickname:string;
 username?:string|null;
 privacyLevelOptions:TikTokPrivacy[];
 commentDisabled:boolean;
 duetDisabled:boolean;
 stitchDisabled:boolean;
 maxVideoPostDurationSec:number;
};

export type TikTokDraft={
 title:string;
 privacyLevel:TikTokPrivacy|'';
 allowComment:boolean;
 allowDuet:boolean;
 allowStitch:boolean;
 discloseCommercial:boolean;
 ownBrand:boolean;
 brandedContent:boolean;
};
export type TikTokPost=Omit<TikTokDraft,'privacyLevel'|'discloseCommercial'>&{
 connectionId:string;
 privacyLevel:TikTokPrivacy;
 consent:true;
};

export const emptyTikTokDraft:TikTokDraft={
 title:'',privacyLevel:'',allowComment:false,allowDuet:false,allowStitch:false,discloseCommercial:false,ownBrand:false,brandedContent:false
};

export const tiktokInteractions=[
 {field:'allowComment',restriction:'commentDisabled',label:'Comments'},
 {field:'allowDuet',restriction:'duetDisabled',label:'Duet'},
 {field:'allowStitch',restriction:'stitchDisabled',label:'Stitch'}
] as const;

export function isTikTokCreatorInfo(data:Record<string,unknown>):data is TikTokCreatorInfo {
 return typeof data.connectionId==='string'&&data.connectionId.length>0&&
  typeof data.nickname==='string'&&data.nickname.trim().length>0&&
  (data.username==null||typeof data.username==='string')&&
  Array.isArray(data.privacyLevelOptions)&&data.privacyLevelOptions.every(option=>
   typeof option==='string'&&Object.hasOwn(tiktokPrivacyLabels,option))&&
  tiktokInteractions.every(({restriction})=>typeof data[restriction]==='boolean')&&
  typeof data.maxVideoPostDurationSec==='number'&&Number.isFinite(data.maxVideoPostDurationSec)&&
  data.maxVideoPostDurationSec>0;
}

export const tiktokSupportsBrandedContent=(privacy:TikTokPrivacy)=>
 privacy==='PUBLIC_TO_EVERYONE'||privacy==='MUTUAL_FOLLOW_FRIENDS';

// TikTok requires at least three seconds. The shared vertical renderer caps audio at 180.
export const tikTokMinDuration=3;
export const tikTokMaxDuration=(creator:TikTokCreatorInfo)=>Math.min(180,creator.maxVideoPostDurationSec);

export function tiktokPostForSubmission(creator:TikTokCreatorInfo|null,draft:TikTokDraft,
 duration:number|null,consent:boolean):TikTokPost|null{
 if(!creator||!draft.privacyLevel||!creator.privacyLevelOptions.includes(draft.privacyLevel)||
  (draft.brandedContent&&!tiktokSupportsBrandedContent(draft.privacyLevel))||!consent||
  draft.discloseCommercial!==(draft.ownBrand||draft.brandedContent)||
  duration===null||!Number.isFinite(duration)||duration<tikTokMinDuration||duration>tikTokMaxDuration(creator)||
  tiktokInteractions.some(({field,restriction})=>draft[field]&&creator[restriction]))return null;
 const {title,privacyLevel,allowComment,allowDuet,allowStitch,ownBrand,brandedContent}=draft;
 return {connectionId:creator.connectionId,title:title.trim(),privacyLevel,
  allowComment,allowDuet,allowStitch,ownBrand,brandedContent,consent:true};
}
