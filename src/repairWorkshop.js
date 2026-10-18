'use strict';
// Governed, non-self-activating repair tool builder. All input/output is bytes,
// never project filesystem access. The authorized project host owns I/O and approvals.
const crypto = require('node:crypto');
const SHA = /^[a-f0-9]{64}$/;
const safeName = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const languages = Object.freeze(['javascript','typescript','python','django','java','c','c++','c#','powershell','shell','html','css','react','react-native','json']);
const permittedRecipes = Object.freeze(['json-trailing-comma','json-format','exact-block-replace']);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const safeClone = value => JSON.parse(JSON.stringify(value));
const safePath = file => {
  if (typeof file !== 'string' || file.includes('\\') || file.includes('\0') || /[\r\n]/.test(file) || file.startsWith('/') || file.startsWith('~') || file.includes(':')) throw new Error('INVALID_REPAIR_PATH');
  const segments=file.split('/');
  if (!segments.length || segments.some(v=>v===''||v==='.'||v==='..')) throw new Error('INVALID_REPAIR_PATH');
  if (segments.some(v=>/^\.git$|^\.env(?:\..+)?$|^node_modules$|^\.nexus$|^\.github$|^governingDocuments$/i.test(v))) throw new Error('PROTECTED_REPAIR_PATH');
  return file;
};
function validateSpec(s) {
  if(!s||typeof s!=='object'||Array.isArray(s)) throw new Error('INVALID_REPAIR_SPEC');
  const allowed=['schemaVersion','toolId','projectId','repositoryId','repository','branch','baseCommit','file','language','recipe','beforeSha256','oldText','newText','reason','failureId','proposedBy'];
  for(const key of Object.keys(s)) if(!allowed.includes(key)) throw new Error('UNKNOWN_SPEC_FIELD:'+key);
  if(s.schemaVersion!==1||!safeName.test(s.toolId||'')||!safeName.test(s.projectId||'')||!Number.isSafeInteger(s.repositoryId)||s.repositoryId<1||!/^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/.test(s.repository||'')||!/^refs\/heads\/[a-zA-Z0-9._/-]+$/.test(s.branch||'')||s.branch.includes('..')||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(s.baseCommit||'')||!SHA.test(s.beforeSha256||'')||!languages.includes(s.language)||!permittedRecipes.includes(s.recipe)||typeof s.reason!=='string'||!s.reason.trim()||typeof s.failureId!=='string'||!s.failureId.trim()||!safeName.test(s.proposedBy||''))throw new Error('INVALID_REPAIR_SPEC');
  safePath(s.file);
  if(s.recipe.startsWith('json-') && s.language!=='json') throw new Error('RECIPE_LANGUAGE_MISMATCH');
  if(s.recipe==='exact-block-replace'){
    if(!['oldText','newText'].every(k=>typeof s[k]==='string' && s[k].length>0&&s[k].length<=4096) || s.oldText===s.newText || Math.abs(s.oldText.length-s.newText.length)>4096)throw new Error('INVALID_EXACT_REPLACEMENT');
  }else if(s.oldText!==undefined||s.newText!==undefined)throw new Error('UNEXPECTED_REPLACEMENT');
  return Object.freeze(safeClone(s));
}
// State-machine rather than regex: commas within JSON strings are never touched.
function removeJsonTrailingCommas(input) {
  let inString=false,escaped=false,out='',edits=0;
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(inString){out+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
    if(c==='"'){inString=true;out+=c;continue;}
    if(c===','){
      let j=i+1;while(j<input.length && /[ \t\r\n]/.test(input[j]))j++;
      if(input[j]===']'||input[j]==='}') {edits++;continue;}
    }
    out+=c;
  }
  if(inString)throw new Error('UNTERMINATED_JSON_STRING');
  if(!edits)throw new Error('NO_REPAIR_APPLICABLE');
  JSON.parse(out);
  return {after:out,edits};
}
function applyRecipe(spec,before){
  if(spec.recipe==='json-trailing-comma')return removeJsonTrailingCommas(before);
  if(spec.recipe==='json-format'){
    const parsed=JSON.parse(before);
    const after=JSON.stringify(parsed,null,2)+'\n';
    if(after===before)throw new Error('NO_REPAIR_APPLICABLE');
    return {after,edits:1,reviewWarning:'JSON reserialization may eliminate duplicate keys or original formatting: review required'};
  }
  if(spec.recipe==='exact-block-replace'){
    const index=before.indexOf(spec.oldText);
    if(index<0||before.indexOf(spec.oldText,index+spec.oldText.length)!==-1)throw new Error('REPLACEMENT_MUST_MATCH_EXACTLY_ONCE');
    return {after:before.slice(0,index)+spec.newText+before.slice(index+spec.oldText.length),edits:1};
  }
  throw new Error('UNKNOWN_RECIPE');
}
function planRepair(spec, beforeBytes, context){
  const tool=validateSpec(spec);
  if(!context||context.projectId!==tool.projectId||context.repositoryId!==tool.repositoryId||context.repository!==tool.repository||context.branch!==tool.branch||context.baseCommit!==tool.baseCommit||context.file!==tool.file)throw new Error('PROJECT_SCOPE_MISMATCH');
  if(typeof beforeBytes!=='string'||Buffer.byteLength(beforeBytes)>256*1024)throw new Error('BOUNDED_TEXT_INPUT_REQUIRED');
  const beforeSha256=sha256(beforeBytes);
  if(beforeSha256!==tool.beforeSha256)throw new Error('BASE_SHA_MISMATCH');
  const change=applyRecipe(tool,beforeBytes);
  if(Buffer.byteLength(change.after)>256*1024)throw new Error('REPAIR_OUTPUT_TOO_LARGE');
  return Object.freeze({schemaVersion:1,kind:'repair-candidate',toolId:tool.toolId,projectId:tool.projectId,repositoryId:tool.repositoryId,repository:tool.repository,branch:tool.branch,baseCommit:tool.baseCommit,file:tool.file,language:tool.language,recipe:tool.recipe,failureId:tool.failureId,beforeSha256,afterSha256:sha256(change.after),after:change.after,edits:change.edits,reviewWarning:change.reviewWarning||null,authorization:'not-granted',independentlyVerified:false,activated:false});
}
// Orchestrator can author a real JS code artifact, but only from vetted static
// templates and JSON-encoded data. Never eval/import generated code as authority.
function buildTool(spec){
  const validated=validateSpec(spec);
  const source=`'use strict';\n// Generated repair tool for an exact approved *proposal* scope.\n// This module cannot read files, run commands, write projects or authorize itself.\nconst { planRepair } = require('../src/repairWorkshop');\nconst spec = Object.freeze(${JSON.stringify(validated,null,2)});\nfunction proposeRepair(originalBytes, projectContext) { return planRepair(spec, originalBytes, projectContext); }\nmodule.exports = Object.freeze({ spec, proposeRepair });\n`;
  return Object.freeze({toolId:validated.toolId,source,sha256:sha256(source),spec:validated,activation:'pending-independent-review',execution:'isolated-staging-only',permissions:[],installer:false});
}
function trialTool(spec, positive, negative, context) {
  const staged=buildTool(spec);
  const candidate=planRepair(spec,positive.before,context);
  if(candidate.after!==positive.expectedAfter)throw new Error('POSITIVE_CONTROL_FAILED');
  if(typeof negative?.before!=='string')throw new Error('NEGATIVE_CONTROL_REQUIRED');
  let refused=false;
  try{applyRecipe(staged.spec,negative.before);}catch{refused=true;}
  if(!refused)throw new Error('NEGATIVE_CONTROL_FAILED');
  return Object.freeze({status:'staged-awaiting-independent-review',toolId:staged.toolId,sourceSha256:staged.sha256,fixtureBeforeSha256:candidate.beforeSha256,fixtureAfterSha256:candidate.afterSha256,positiveControl:true,negativeControl:true,permissionGranted:false,proofStageSatisfied:false,promotionAuthorized:false});
}
module.exports={languages,permittedRecipes,sha256,safePath,validateSpec,removeJsonTrailingCommas,buildTool,planRepair,trialTool};
