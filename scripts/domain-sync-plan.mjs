// Read-only planner. Feed fresh Vercel API snapshots; never executes mutations.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const projectId='prj_3GYsUgeNUReJ498zzxjLdUULWObF';
export const teamId='team_BJkIJAD36GgP4CBt3TfXBJfn';
export const hostname='1ce-v2-tofdidthat.vercel.app';
export function planDomainSync({project,alias,domain}){
 if(project.id!==projectId||project.accountId!==teamId||alias.projectId!==projectId||alias.alias!==hostname)throw new Error('Unexpected project, team or alias; stop');
 if(alias.redirect)throw new Error('Alias redirects; investigate before changing');
 if(domain&&(domain.name!==hostname||domain.gitBranch||domain.customEnvironmentId||domain.redirect||domain.verified!==true))throw new Error('Domain is not verified production routing; investigate');
 const deploymentId=alias.deploymentId||alias.deployment?.id;
 if(!deploymentId)throw new Error('Missing current alias deployment');
 return {
  status:domain?'configured':'approval-required',
  request:domain?null:{method:'POST',path:`/v10/projects/${projectId}/domains?teamId=${teamId}`,body:{name:hostname}},
  previousDeploymentId:deploymentId,
  constraints:['Keep WEB_ORIGIN, Google callback, cookies and PKCE unchanged.','No redirect between origins: sessionStorage verifier is origin-bound.','Do not remove or force-transfer an existing domain on conflict.'],
  verification:['Read project domain: verified, no gitBranch/customEnvironmentId/redirect.','After the next authorized production deployment, compare both alias deployment IDs with that deployment.','Validate Google login, logout and session on the login hostname; verify CORS rejects other origins.'],
  rollback:'Requires separate approval: restore the recorded alias deployment and review project-domain association. Never delete or transfer automatically.'
 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(planDomainSync(JSON.parse(readFileSync(process.argv[2],'utf8'))),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
