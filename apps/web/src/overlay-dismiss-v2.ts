// Backdrop dismissal for the pack dialog. The scrolling overlay is itself the
// backdrop, so a mouse press on its scrollbar also targets the overlay. Only a
// press inside the overlay's client box (which excludes the scrollbar) may
// dismiss it; dragging the scrollbar must never close the card.
export type OverlayElementV2={
 getBoundingClientRect:()=>{left:number;top:number};
 clientWidth:number;clientHeight:number;
};
export type OverlayPointerEventV2={
 target:unknown;currentTarget:unknown;clientX:number;clientY:number;
};

export function isBackdropDismissV2(event:OverlayPointerEventV2,element:OverlayElementV2){
 if(event.target!==event.currentTarget)return false;
 const rect=element.getBoundingClientRect();
 return event.clientX<rect.left+element.clientWidth&&
  event.clientY<rect.top+element.clientHeight;
}
