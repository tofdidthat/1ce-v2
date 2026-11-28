export const previewSecondsV2=29;

// Keep media time separate from UI state. Pause, buffering and seeking clear
// the anchor so positions reached without playback never count as listening.
export class PlayerPreviewV2 {
 private enabled=false;
 private elapsed=0;
 private anchor:number|null=null;
 private advancing=false;

 setEnabled(enabled:boolean,position:number|null){
  this.enabled=enabled;
  this.elapsed=0;
  this.anchor=enabled?position:null;
 }

 resetTrack(){
  this.elapsed=0;
  this.anchor=null;
  this.advancing=false;
 }

 resume(position:number){
  if(this.enabled&&!this.advancing)this.anchor=position;
 }

 suspend(position?:number){
  if(position!==undefined)this.sample(position);
  this.anchor=null;
 }

 sample(position:number){
  if(!this.enabled||this.advancing||this.anchor===null)return false;
  this.elapsed+=Math.max(0,position-this.anchor);
  this.anchor=position;
  return this.elapsed>=previewSecondsV2;
 }

 claimTransition(){
  if(this.advancing)return false;
  this.advancing=true;
  this.anchor=null;
  return true;
 }
}
