'use strict';
// Read-only evidence classifier; does not run tests, apply patches or self-approve.
const SHA40=/^[a-f0-9]{40}$/, SHA64=/^[a-f0-9]{64}$/;
function assessRepairEvidence(input={}) {
  const missing=[];
  if(!SHA40.test(input.baseCommit)) missing.push('exact base commit');
  if(!SHA40.test(input.repairCommit)) missing.push('immutable repair commit');
  if(!SHA64.test(input.beforeDiagnosisSha256)) missing.push('before diagnosis hash');
  if(!SHA64.test(input.afterDiagnosisSha256)) missing.push('after diagnosis hash');
  if(!Array.isArray(input.requestedTests)||!input.requestedTests.length||input.requestedTests.some(x=>typeof x!=='string'||!/^test\/[A-Za-z0-9_.-]+\.test\.js$/.test(x))) missing.push('bounded test selection');
  const runs=Array.isArray(input.testRuns)?input.testRuns:[];
  if(!missing.includes('bounded test selection') && input.requestedTests.some(t=>!runs.some(r=>r.test===t && r.ok===true && SHA64.test(r.outputSha256) && r.skipped!==true))) missing.push('all requested native test results');
  if(input.beforeDiagnosisSha256===input.afterDiagnosisSha256 && SHA64.test(input.beforeDiagnosisSha256))missing.push('changed diagnosis evidence');
  if(input.independentVerifier!==true)missing.push('distinct independent verifier');
  if(input.rollbackTested!==true)missing.push('safe rollback test');
  if(input.negativeTestsPassed!==true)missing.push('negative and regression checks');
  if(!SHA64.test(input.signedReceiptSha256))missing.push('signed independent receipt');
  return Object.freeze({status:missing.length?'INSUFFICIENT_EVIDENCE':'EVIDENCE_REVIEW_READY',missing:Object.freeze(missing),observationOnly:true,repairAuthorized:false,knowledgePromotionAuthorized:false,releaseAuthorized:false,proofStageSatisfied:false});
}
module.exports={assessRepairEvidence};
