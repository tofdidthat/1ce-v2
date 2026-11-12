import test from 'node:test';
import assert from 'node:assert/strict';
import {planDomainSync,projectId,teamId,hostname} from '../../../scripts/domain-sync-plan.mjs';
const snapshot=()=>({project:{id:projectId,accountId:teamId},alias:{projectId,alias:hostname,deploymentId:'dpl_fixture'},domain:null});
test('manual alias yields production association proposal, no redirect or branch',()=>{
 const plan=planDomainSync(snapshot());
 assert.equal(plan.status,'approval-required');
 assert.deepEqual(plan.request.body,{name:hostname});
 assert.equal(plan.previousDeploymentId,'dpl_fixture');
});
test('already configured production association is a no-op',()=>{
 const input=snapshot();input.domain={name:hostname,verified:true};
 assert.equal(planDomainSync(input).request,null);
});
test('wrong ownership, redirects, unverified and preview bindings fail closed',()=>{
 for(const update of [s=>s.project.accountId='other',s=>s.alias.projectId='other',s=>s.alias.redirect='https://other.invalid',s=>s.domain={name:hostname,verified:false},s=>s.domain={name:hostname,verified:true,gitBranch:'main'},s=>delete s.alias.deploymentId]){
  const input=snapshot();update(input);assert.throws(()=>planDomainSync(input));
 }
});
