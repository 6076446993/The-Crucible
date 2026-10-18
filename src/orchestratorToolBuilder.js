'use strict';
// Planner/author only. Never executes unknown code, downloads dependencies,
// touches Nexus projects, commits, grants permissions, or certifies itself.
const {buildTool,trialTool,sha256,languages} = require('./repairWorkshop');
function requestTool({diagnosis,toolInventory=[],proposal,positiveControl,negativeControl,context}){
  if(!diagnosis||diagnosis.projectId!==context?.projectId||diagnosis.repositoryId!==context?.repositoryId||typeof diagnosis.failureId!=='string'||!diagnosis.failureId)throw new Error('AUTHENTICATED_PROJECT_DIAGNOSIS_REQUIRED');
  if(proposal.failureId!==diagnosis.failureId)throw new Error('FAILURE_ID_MISMATCH');
  if(!languages.includes(proposal.language))throw new Error('UNKNOWN_LANGUAGE_NEEDS_RESEARCH');
  const existing=toolInventory.find(t=>t.language===proposal.language&&t.recipe===proposal.recipe&&t.status==='independently-approved');
  if(existing)return Object.freeze({state:'reuse-existing-tool',toolId:existing.toolId,authorization:'still-required-for-this-project',proofStageSatisfied:false});
  const built=buildTool(proposal);
  const trial=trialTool(proposal,positiveControl,negativeControl,context);
  return Object.freeze({state:'new-tool-built-in-staging',toolId:built.toolId,code:built.source,sourceSha256:built.sha256,manifest:{projectId:context.projectId,repositoryId:context.repositoryId,branch:context.branch,language:proposal.language,recipe:proposal.recipe,diagnosisSha256:sha256(JSON.stringify(diagnosis)),toolSourceSha256:built.sha256,permissions:[],distribution:'none',selfInstall:false,independentTestsRequired:true},trial,independentlyVerified:false,ownerAuthorized:false,releaseAuthorized:false});
}
module.exports={requestTool};
