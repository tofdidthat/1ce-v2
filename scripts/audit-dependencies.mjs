// Audits the committed pnpm dependency graph in GitHub Actions.
// Fail closed on registry/network/parser errors; print counts without dumping
// advisory payloads, lockfile contents or credentials.
import {spawnSync} from 'node:child_process';

let failed=false;
for (const target of [
 {label:'complete workspace (runtime + build)',args:['audit','--json']},
 {label:'production dependencies',args:['audit','--prod','--json']}
]) {
 const result=spawnSync('pnpm',target.args,{
  cwd:process.cwd(),encoding:'utf8',maxBuffer:12*1024*1024,
  env:{...process.env,CI:'true'}
 });
 if(result.error){console.error('Dependency audit unavailable for '+target.label+': '+result.error.message);failed=true;continue;}
 let report;
 try{report=JSON.parse(result.stdout)}catch{
  console.error('Dependency audit could not parse a complete JSON report for '+target.label+' (pnpm exit '+result.status+').');
  failed=true;continue;
 }
 if(report?.error||!report||typeof report!=='object'){
  console.error('Dependency audit provider returned an error for '+target.label+'.');
  failed=true;continue;
 }
 const counts=report.metadata?.vulnerabilities;
 if(!counts||!['critical','high','moderate','low'].every(key=>typeof counts[key]==='number')){
  console.error('Dependency audit format is unknown for '+target.label+'; refusing to assume clean.');
  failed=true;continue;
 }
 console.log('Audit '+target.label+': '+['critical','high','moderate','low','info'].map(k=>k+'='+String(counts[k]??0)).join(', '));
 const advisories=Object.values(report.advisories||{});
 if(advisories.length){
  for(const adv of advisories.slice(0,25)){
   const severity=typeof adv.severity==='string'?adv.severity:'unknown';
   const name=typeof adv.module_name==='string'?adv.module_name:'(unknown dependency)';
   const id=Number.isSafeInteger(adv.github_advisory_id)?String(adv.github_advisory_id):typeof adv.github_advisory_id==='string'?adv.github_advisory_id:'';
   console.log('  '+severity+' '+name+(id?' '+id:''));
  }
  if(advisories.length>25)console.log('  ... additional advisories omitted');
 }
 if(counts.critical>0||counts.high>0){
  console.error('Release gate blocked: unresolved high/critical dependency audit findings in '+target.label+'.');
  failed=true;
 }else if(result.status!==0&&counts.moderate===0&&counts.low===0&&counts.info===0){
  // pnpm exited abnormally without actionable vulnerability results.
  console.error('Dependency audit exited unexpectedly for '+target.label+'.');
  failed=true;
 }
}
if(failed)process.exitCode=1;
