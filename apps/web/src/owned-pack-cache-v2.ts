// Reuse only the current viewer's own pack tracks. A generation prevents
// requests started before invalidation from repopulating stale entries.
export class OwnedPackCacheV2<T>{
 private viewer:number|undefined;
 private generation=0;
 private entries=new Map<string,T>();
 setViewer(viewer:number|undefined){if(this.viewer!==viewer){this.viewer=viewer;this.clear()}}
 clear(){this.generation++;this.entries.clear()}
 token(){return this.generation}
 get(viewer:number|undefined,owner:number,id:string){
  return viewer!==undefined&&viewer===this.viewer&&owner===viewer?this.entries.get(id):undefined;
 }
 put(viewer:number|undefined,owner:number,id:string,value:T,token:number){
  if(viewer!==undefined&&viewer===this.viewer&&owner===viewer&&token===this.generation)this.entries.set(id,value);
 }
}
