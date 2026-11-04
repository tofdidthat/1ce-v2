// CI source-policy check. Production sources must remain TypeScript-first.
// Generated dist/*.js, JavaScript tests and operational scripts are permitted.
import {readFileSync,readdirSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const temporaryExemptions=new Set([
 'apps/web/src/workspace-v1.tsx',
 'apps/web/src/library-upload-v1.tsx',
]);
function walk(dir){
 const found=[];
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);
  if(entry.isDirectory())found.push(...walk(path));
  else if(entry.isFile())found.push(path);
 }
 return found;
}
export function checkTypeScriptPolicy(root=process.cwd(),exemptions=temporaryExemptions){
 const errors=[];
 for(const name of ['apps/api/tsconfig.json','apps/web/tsconfig.json']){
  const config=JSON.parse(readFileSync(join(root,name),'utf8'));
  if(config.compilerOptions?.strict!==true)errors.push(name+': strict must remain true');
  if(config.compilerOptions?.allowJs!==false)errors.push(name+': allowJs must remain false');
 }
 const encountered=new Set();
 for(const directory of ['apps/api/src','apps/web/src']){
  for(const absolute of walk(join(root,directory))){
   const path=relative(root,absolute).replaceAll('\\','/');
   if(/\.(?:js|jsx|mjs|cjs)$/i.test(path))errors.push(path+': JavaScript production source is forbidden');
   if(!/\.(?:ts|tsx)$/i.test(path))continue;
   const source=readFileSync(absolute,'utf8');
   if(/\/\/\s*@ts-ignore\b/.test(source))errors.push(path+': @ts-ignore forbidden');
   if(/\/\/\s*@ts-nocheck\b/.test(source)){
    encountered.add(path);
    if(!exemptions.has(path))errors.push(path+': @ts-nocheck forbidden');
   }
  }
 }
 for(const file of exemptions)if(!encountered.has(file))errors.push(file+': stale @ts-nocheck exemption');
 return errors;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const violations=checkTypeScriptPolicy();
 if(violations.length){for(const issue of violations)console.error('TypeScript policy: '+issue);process.exitCode=1;}
 else console.log('TypeScript production source policy: PASS');
}
