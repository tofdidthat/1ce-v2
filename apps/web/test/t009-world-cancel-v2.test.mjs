import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

// This file EXECUTES the real world-v2.tsx component code against a minimal
// hook runtime, so World's request lifecycle (transition + cancellation) is
// exercised end to end instead of only pattern-checked.

const here=path.dirname(fileURLToPath(import.meta.url));
const webRoot=path.resolve(here,'..');
const repoRoot=path.resolve(webRoot,'..','..');
// pnpm keeps transitive dependencies nested; resolve esbuild from its store.
const pnpmStore=path.join(repoRoot,'node_modules','.pnpm');
const esbuildPackage=fs.readdirSync(pnpmStore).find(dir=>dir.startsWith('esbuild@'));
if(!esbuildPackage)throw new Error('esbuild not found in the pnpm store');
const esbuild=createRequire(path.join(pnpmStore,esbuildPackage,'node_modules','esbuild','package.json'))('esbuild');
const stubRequire=createRequire(path.join(here,'t009-react-stub.cjs'));
const reactStub=stubRequire('./t009-react-stub.cjs');
const followsStub=stubRequire('./t009-follows-stub.cjs');

const bundlePath=path.join(here,'t009-world-bundle.cjs');
let bundleReady=null;
function bundle(){
 if(bundleReady)return bundleReady;
 const posix=file=>file.split(path.sep).join('/');
 bundleReady=esbuild.build({
  entryPoints:[path.join(webRoot,'src','world-v2.tsx')],
  bundle:true,format:'cjs',platform:'node',outfile:bundlePath,
  jsx:'transform', // classic createElement so the stub React is sufficient
  tsconfigRaw:{compilerOptions:{jsx:'react'}}, // override the app's react-jsx setting
  loader:{'.css':'empty'},
  logLevel:'silent',
  plugins:[{name:'t009-stubs',setup(build){
   build.onResolve({filter:/^react$/},()=>({external:true,path:posix(path.join(here,'t009-react-stub.cjs'))}));
   build.onResolve({filter:/^lucide-react$/},()=>({external:true,path:posix(path.join(here,'t009-lucide-stub.cjs'))}));
   build.onResolve({filter:/^\.\//},args=>{
    if(args.path==='./profile-follows-v2')return{external:true,path:posix(path.join(here,'t009-follows-stub.cjs'))};
    return null;
   });
  }}]
 }).then(()=>stubRequire('./t009-world-bundle.cjs').default);
 return bundleReady;
}

function texts(node,acc=[]){
 if(node===null||node===undefined||node===false||node===true)return acc;
 if(typeof node==='string'||typeof node==='number'){acc.push(String(node));return acc;}
 if(Array.isArray(node)){for(const child of node)texts(child,acc);return acc;}
 if(typeof node==='object'){texts(node.props&&node.props.children,acc);}
 return acc;
}
function renderWorld(Component,props){
 const tree=reactStub.render(Component,props);
 reactStub.flush();
 return tree;
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test.beforeEach(async()=>{
 await bundle();
 reactStub.reset();
 followsStub.reset();
});

test('World fetch starts only on the Following tab of an active signed view',async()=>{
 const Component=await bundleReady;
 const props={userId:7,active:true,onOpenProfile:()=>{}};
 renderWorld(Component,props);
 assert.equal(followsStub.calls.length,0); // For you: no request at all
 reactStub.setters[0]('following');
 renderWorld(Component,props);
 assert.equal(followsStub.calls.length,1);
 assert.equal(followsStub.calls[0].id,7);
 assert.equal(followsStub.calls[0].signal.aborted,false);
 assert.match(texts(reactStub.lastTree).join(' '),/Loading following…/);
});

test('deactivating the World view aborts the in-flight request',async()=>{
 const Component=await bundleReady;
 const base={userId:7,active:true,onOpenProfile:()=>{}};
 renderWorld(Component,base);
 reactStub.setters[0]('following');
 renderWorld(Component,base);
 assert.equal(followsStub.calls.length,1);
 const call=followsStub.calls[0];
 renderWorld(Component,{...base,active:false}); // view switch away
 assert.equal(call.signal.aborted,true,'cleanup must abort the pending request');
 followsStub.resolve(call,{followingUsers:[{id:1,username:'late-result'}]});
 await tick();
 renderWorld(Component,{...base,active:false});
 const text=texts(reactStub.lastTree).join(' ');
 assert.doesNotMatch(text,/late-result/); // late data after abort is discarded
 assert.match(text,/Loading following…/); // state stayed verified-loading, no error
});

test('reactivating the World view starts a fresh request and renders the verified list',async()=>{
 const Component=await bundleReady;
 const base={userId:7,active:true,onOpenProfile:()=>{}};
 renderWorld(Component,base);
 reactStub.setters[0]('following');
 renderWorld(Component,base);
 const first=followsStub.calls[0];
 renderWorld(Component,{...base,active:false});
 assert.equal(first.signal.aborted,true);
 renderWorld(Component,{...base,active:true});
 reactStub.flush();
 assert.equal(followsStub.calls.length,2,'reactivation revalidates once');
 assert.equal(followsStub.calls[1].signal.aborted,false);
 followsStub.resolve(followsStub.calls[1],{followingUsers:[
  {id:1,username:'artist-one'},{id:2,username:'artist-two'}
 ]});
 await tick();
 const tree=renderWorld(Component,{...base,active:true});
 const text=texts(tree).join(' ');
 assert.match(text,/artist-one/);
 assert.match(text,/artist-two/);
 assert.doesNotMatch(text,/Loading following…/);
});

test('switching viewer clears Following before any new data arrives',async()=>{
 const Component=await bundleReady;
 const base={userId:7,active:true,onOpenProfile:()=>{}};
 renderWorld(Component,base);
 reactStub.setters[0]('following');
 renderWorld(Component,base);
 followsStub.resolve(followsStub.calls[0],{followingUsers:[{id:5,username:'old-account'}]});
 await tick();
 renderWorld(Component,base);
 assert.match(texts(reactStub.lastTree).join(' '),/old-account/);
 renderWorld(Component,{...base,userId:9});
 reactStub.flush();
 assert.equal(followsStub.calls.length,2);
 assert.equal(followsStub.calls[1].id,9);
 const text=texts(reactStub.lastTree).join(' ');
 assert.doesNotMatch(text,/old-account/); // previous account's list is gone
 assert.match(text,/Loading following…/);
});
