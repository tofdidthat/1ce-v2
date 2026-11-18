export type TikTokDraftUpload={connectionId:string;consent:true};

export const tikTokMinDuration=3;
export const tikTokMaxDuration=180;

export function tiktokDraftForSubmission(connectionId:string|null|undefined,
 duration:number|null,consent:boolean):TikTokDraftUpload|null{
 if(!connectionId||!consent||duration===null||!Number.isFinite(duration)||
  duration<tikTokMinDuration||duration>tikTokMaxDuration)return null;
 return {connectionId,consent:true};
}
