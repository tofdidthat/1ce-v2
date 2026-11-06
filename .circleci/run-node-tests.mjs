// Adapter between Node's built-in JUnit reporter and CircleCI test atoms.
// Node does not include the source filename on testcase records; CircleCI
// requires each attempted test atom to be identifiable in the XML report.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

const [suite,output,...atoms]=process.argv.slice(2);
if(!['web','api'].includes(suite)||!output||atoms.length===0){
 console.error('Usage: node run-node-tests.mjs <web|api> <junit.xml> <test files...>');
 process.exit(2);
}
const pattern=suite==='web'
 ? /^apps\/web\/test\/[\w.-]+\.test\.mjs$/
 : /^apps\/api\/test\/[\w.-]+\.test\.js$/;
const escapeXml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
const reports=[];
let failed=false;
for(const file of atoms){
 if(!pattern.test(file))throw Error('Unexpected test atom: '+file);
 const options=suite==='web'?['--experimental-strip-types']:[];
 const result=spawnSync(process.execPath,[...options,'--test','--test-reporter=junit',file],{encoding:'utf8',maxBuffer:16*1024*1024});
 const report=result.stdout||'';
 const xml=report.match(/<testsuites(?:\s[^>]*)?>([\s\S]*?)<\/testsuites>/);
 let body=xml?.[1].replace(/<!--[\s\S]*?-->/g,'').trim()||'';
 let count=(body.match(/<testcase\b/g)||[]).length;
 const path=escapeXml(file);
 if(count){
  body=body.replace(/<testcase\b/g,`<testcase file="${path}"`);
 }else{
  failed=true;
  count=1;
  const cause=(result.stderr||report||result.error?.message||'No Node.js JUnit test cases were emitted').slice(0,4000);
  body=`<testcase name="${path}" classname="${path}" file="${path}"><failure message="No test result">${escapeXml(cause)}</failure></testcase>`;
 }
 if(result.status!==0){
  failed=true;
  console.error(`FAIL ${file} (exit ${result.status??'unknown'})`);
  if(result.stderr)console.error(result.stderr.slice(0,2000));
 }else console.log(`PASS ${file}`);
 reports.push(`<testsuite name="${path}" tests="${count}">${body}</testsuite>`);
}
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,'<?xml version="1.0" encoding="utf-8"?>\n<testsuites>\n'+reports.join('\n')+'\n</testsuites>\n');
console.log('Saved JUnit for '+atoms.length+' test atoms to '+output);
if(failed)process.exitCode=1;
