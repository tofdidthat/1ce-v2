import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const library=read('library-items-v2.tsx');
const menuSource=read('project-context-menu-v2.tsx');
const icons=menuSource.match(/import \{([^}]+)\} from 'lucide-react'/)[1].replaceAll(' as ',':');
const source=menuSource.replace(/^import .*;\r?\n/gm,'').replace('export default function','function');
const code=transformSync(source,{loader:'tsx',jsx:'transform'}).code;
const React={createElement:(type,props,...children)=>({type,props:{...props,children}})};
const render=new Function('React','window',`const {${icons}}=new Proxy({},{get:(_,name)=>name});const CopyLinkIconV2='icon';${code};return ProjectContextMenuV2;`)(React,{innerWidth:1000,innerHeight:800});
function nodes(tree){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(nodes);return [tree,...nodes(tree.props?.children)];}
test('visitor and anonymous beat menus show disabled Buy first, with separator and no admin',()=>{
 for(const viewer of ['visitor','anonymous']){
  const tree=render({project:{id:'beat',kind:'beat',title:viewer},owner:false,x:0,y:0,saved:false,published:false,onAction:()=>assert.fail('admin')});
  const items=nodes(tree).filter(n=>n.props?.role==='menuitem');
  assert.equal(items[0].props.children[1].props.children[0],'Buy');
  assert.equal(items[0].props.disabled,true);assert.equal(items[0].props.onClick,undefined);
  assert.equal(nodes(tree).filter(n=>n.props?.role==='separator').length,1);
  assert.ok(!items.some(n=>n.props.children[1].props.children[0]==='Delete'));
 }
});
test('owners and whole packs never gain Buy',()=>{
 for(const [owner,kind] of [[true,'beat'],[true,'pack'],[false,'pack']]){
  const tree=render({project:{id:'id',kind,title:'fixture'},owner,x:0,y:0,saved:false,published:false,onAction:()=>{}});
  assert.ok(!nodes(tree).some(n=>n.type==='span'&&n.props.children[0]==='Buy'));
 }
});
test('right click binds each actual beat and stops propagation instead of selecting pack',()=>{
 const start=library.indexOf(' const showBeatMenu='),end=library.indexOf(' const showPackMenu=',start);
 const handlerCode=transformSync(library.slice(start,end),{loader:'tsx'}).code;
 let selected,cleared=false;
 const show=new Function('setContextPack','setContextBeat',handlerCode+';return showBeatMenu;')(()=>{cleared=true},value=>{selected=value});
 for(const owner_id of [1,2])for(const id of ['track-a','track-b']){
  let prevented=false,stopped=false;const beat={owner_id,id,title:id};
  show({clientX:44,clientY:55,preventDefault(){prevented=true},stopPropagation(){stopped=true}},beat);
  assert.equal(selected.beat,beat);assert.equal(selected.x,44);assert.ok(prevented&&stopped&&cleared);
 }
 assert.match(library,/onContextMenu=\{e=>showBeatMenu\(e,beat\)\}/);
 assert.match(library,/owner=\{contextBeat.beat.owner_id===userId\}/);
 assert.match(library,/toggleSaved\(beat.owner_id,'beat',beat.id\)/);
 assert.match(library,/publicProjectLinkV2\(window.location.origin,beat.owner_id,'beat',beat.id\)/);
 assert.match(library,/fetchPlayableProjectV2\(beat.owner_id,'beat',beat.id,controller.signal\)/);
 assert.match(library,/if\(contextBeat.beat.owner_id===userId\)showProjectAction/);
});
