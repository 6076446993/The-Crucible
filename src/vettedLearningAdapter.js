'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {describeCode}=require('./failureCodes');

const PROJECT_ID='github:jonathanblunt1214-lgtm/The-Crucible';

function readJson(file,label){if(!fs.existsSync(file))throw new Error(label+' is missing: '+file);return JSON.parse(fs.readFileSync(file,'utf8'));}
function loadExternalVettedPrevention({root,declarationsFile,completedChecks=[]}){
  const state=readJson(path.join(root,'active-knowledge.json'),'vetted active knowledge');
  const declarations=readJson(declarationsFile,'prevention declarations');
  if(state.projectId!==PROJECT_ID)throw new Error('Vetted learning project identity does not match The Crucible.');
  if(!Array.isArray(state.knowledge))throw new Error('Vetted active knowledge must contain a knowledge array.');
  if(!Array.isArray(declarations))throw new Error('Prevention declarations must be an array.');
  const mappings=[];
  const knowledge=[];
  for(const item of state.knowledge){
    if(!item||item.status!=='active'||item.kind!=='prevention-candidate')continue;
    if(!item.candidateId||!item.proofSha256||!item.claimBoundary||!item.oversightDecisionSha256)throw new Error('Active vetted prevention knowledge is missing custody bindings.');
    if(!item.failureCode||!describeCode(item.failureCode))throw new Error('Active vetted prevention knowledge must reference an active CRU bug/error classification.');
    const declaration=declarations.find(d=>d.failureCode===item.failureCode);
    if(!declaration)throw new Error('No governed prevention declaration exists for '+item.failureCode+'.');
    const boundary=[...new Set(declaration.precursorPaths||[])].sort().join(',');
    if(boundary!==item.claimBoundary)throw new Error('Vetted knowledge boundary does not match the governed prevention declaration.');
    const version=Number(item.knowledgeVersion);
    if(!Number.isSafeInteger(version)||version<1)throw new Error('Vetted prevention knowledgeVersion must be a positive integer.');
    knowledge.push({version,candidateId:item.candidateId,proofSha256:item.proofSha256,boundary:item.claimBoundary,status:'active'});
    mappings.push({failureCode:item.failureCode,canonicalFailureId:item.canonicalFailureId||null,knowledgeVersion:version,knowledgeCandidateId:item.candidateId,proofSha256:item.proofSha256,boundary:item.claimBoundary,action:declaration.action||'require-check',paths:[...declaration.precursorPaths],requiredCheck:declaration.requiredCheck,rationale:declaration.rationale});
  }
  return {knowledge,mappings,completedChecks};
}
module.exports={PROJECT_ID,loadExternalVettedPrevention};
