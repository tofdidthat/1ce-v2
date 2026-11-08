// Minimal React hook runtime for behavioral tests that execute the real
// component code: useState/useRef/useEffect with a manual commit + flush so a
// test can drive dependency changes and observe cleanups (cancellation).
let cursor=0;
const cells=[];
let scene=null;
exports.queued=false;
exports.setters=[];
exports.lastTree=null;
exports.reset=function(){cursor=0;cells.length=0;exports.setters.length=0;exports.queued=false;scene=null;exports.lastTree=null;};
function renderPass(Component,props){
 cursor=0;
 const tree=Component(props);
 exports.lastTree=tree;
 for(let i=0;i<cells.length;i++){
  const cell=cells[i];
  if(cell&&cell.fn&&cell.dirty){
   if(cell.cleanup)cell.cleanup();
   cell.cleanup=cell.fn();
   cell.dirty=false;
  }
 }
 return tree;
}
exports.render=function(Component,props){
 scene={Component,props};
 return renderPass(Component,props);
};
exports.flush=function(){
 let guard=0;
 while(exports.queued){
  if(++guard>25)throw new Error('hook flush did not settle');
  exports.queued=false;
  if(!scene)throw new Error('flush before render');
  renderPass(scene.Component,scene.props);
 }
};
exports.useState=function(initial){
 const i=cursor++;
 if(!(i in cells)){
  const box={value:typeof initial==='function'?initial():initial};
  box.set=updater=>{
   const next=typeof updater==='function'?updater(box.value):updater;
   if(Object.is(next,box.value))return;
   box.value=next;
   exports.queued=true;
  };
  cells[i]=box;
  exports.setters[i]=box.set;
 }
 const current=cells[i];
 return [current.value,current.set];
};
exports.useRef=function(init){
 const i=cursor++;
 if(!(i in cells))cells[i]={current:init};
 return cells[i];
};
exports.useEffect=function(fn,deps){
 const i=cursor++;
 if(!(i in cells)){cells[i]={fn,deps,cleanup:null,dirty:true};return;}
 const cell=cells[i];
 // No previous deps (explicit undefined) or a change re-runs; explicitly the
 // same list keeps the previous run and leaves the earlier cleanup attached.
 const same=cell.deps&&deps&&deps.length===cell.deps.length&&deps.every((d,index)=>Object.is(d,cell.deps[index]));
 cell.fn=fn;
 cell.deps=deps;
 cell.dirty=!same;
};
exports.createElement=function(type,config){
 const props=Object.assign({},config);
 delete props.key;delete props.ref;
 const children=Array.prototype.slice.call(arguments,2);
 if(children.length===1&&!(config&&'children' in config))props.children=children[0];
 else if(children.length>1)props.children=children;
 return {type,props,key:config&&config.key,ref:config&&config.ref};
};
exports.default=exports;
