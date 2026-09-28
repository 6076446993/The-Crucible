'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { crucibleError } = require('./failureCodes');
const { ExternalOversightReflex } = require('./oversightReflex');
const { createProductionOrganism, submitNervousObservation } = require('./productionOrganism');
const { diagnose } = require('./ciDiagnosticOrgan');
const { DurableScientificLearningStore } = require('./scientificLearning');

const DEFAULT_AUTH_FILE = process.env.CRUCIBLE_REPAIR_AUTHORIZATION_FILE ||
  'governingDocuments/active-repair-authorization.json';

function sha256(value) {
  return crypto.createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
}
function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw crucibleError('CRU-0050', `${name} is required.`);
  return value.trim();
}
function readAuthorization(file = DEFAULT_AUTH_FILE, readFile = fs.readFileSync) {
  const text = readFile(file, 'utf8');
  if (!text) throw crucibleError('CRU-0050', `Repair authorization file is empty: ${file}`);
  const authorization = JSON.parse(text);
  if (!authorization || authorization.schemaVersion !== 1) throw crucibleError('CRU-0050', 'Repair authorization must use schemaVersion 1.');
  return authorization;
}
function authorizationScope(a) {
  return {
    schemaVersion:a.schemaVersion, authorizationId:a.authorizationId, repository:a.repository,
    pullRequest:Number(a.pullRequest), headSha:a.headSha, baseBranch:a.baseBranch,
    allowedFailureCodes:a.allowedFailureCodes, allowedOperations:a.allowedOperations,
    issuedAt:a.issuedAt, expiresAt:a.expiresAt,
  };
}
function verifyAuthorization({authorization,repository,pullRequest,headSha,failureCode,now=new Date(),oversightPublicKey=process.env.CRUCIBLE_OVERSIGHT_PUBLIC_KEY,ownerPublicKey=process.env.CRUCIBLE_OWNER_PUBLIC_KEY}) {
  if (!authorization || authorization.schemaVersion!==1) return {authorized:false,reason:'missing-or-invalid-authorization'};
  if (authorization.status!=='active') return {authorized:false,reason:'authorization-not-active'};
  const scope=authorizationScope(authorization);
  if(scope.repository!==repository)return{authorized:false,reason:'repository-mismatch'};
  if(Number(scope.pullRequest)!==Number(pullRequest))return{authorized:false,reason:'pull-request-mismatch'};
  if(scope.headSha!==headSha)return{authorized:false,reason:'head-sha-mismatch'};
  const required=['development-branch-repair','commit','push','retest'];
  if(!Array.isArray(scope.allowedOperations)||required.some(x=>!scope.allowedOperations.includes(x)))return{authorized:false,reason:'required-operation-not-authorized'};
  if(!Array.isArray(scope.allowedFailureCodes)||!scope.allowedFailureCodes.includes(failureCode))return{authorized:false,reason:'failure-code-not-authorized'};
  const issued=Date.parse(scope.issuedAt),expires=Date.parse(scope.expiresAt),current=now.getTime();
  if(!Number.isFinite(issued)||!Number.isFinite(expires)||current<issued||current>=expires)return{authorized:false,reason:'authorization-expired-or-not-yet-active'};
  if(!/^[a-f0-9]{64}$/.test(authorization.scopeSha256)||authorization.scopeSha256!==sha256(scope))return{authorized:false,reason:'authorization-scope-hash-mismatch'};
  if(!oversightPublicKey||!ownerPublicKey)return{authorized:false,reason:'authorization-verification-keys-unavailable'};
  try {
    const reflex=new ExternalOversightReflex({projectId:`github:${repository}`,oversightPublicKey,ownerPublicKey});
    const decision=reflex.evaluate({schemaVersion:1,projectId:`github:${repository}`,decision:authorization.decision,reason:authorization.reason,issuedAt:scope.issuedAt,stateSha256:authorization.scopeSha256,oversightSignature:authorization.oversightSignature,ownerSignature:authorization.ownerSignature});
    if(decision.decision!=='CLEAR'||!decision.ownerVerified)return{authorized:false,reason:'authorization-decision-not-clear'};
  } catch(error) { return {authorized:false,reason:`authorization-signature-invalid: ${error.message}`}; }
  return {authorized:true,authorizationId:requireText(authorization.authorizationId,'authorizationId'),scopeSha256:authorization.scopeSha256,expiresAt:scope.expiresAt};
}
function run(command,args,cwd,env) {
  const result=spawnSync(command,args,{cwd,env,shell:false,encoding:'utf8',maxBuffer:8*1024*1024});
  if(result.error)throw crucibleError('CRU-0050', result.error.message || String(result.error));
  if(result.status!==0)throw crucibleError('CRU-0050', `${command} exited with ${result.status}: ${String(result.stderr||result.stdout||'').slice(-4000)}`);
  return String(result.stdout||'');
}
function git(cwd,args,env){return run('git',args,cwd,env);}
function parseRepairCommand(command) {
  const match=/^npm run ([a-z0-9:_-]+)$/.exec(String(command||'').trim());
  if(!match)throw crucibleError('CRU-0050', `Repair command is outside the bounded npm-run repair surface: ${command}`);
  return {executable:process.platform==='win32'?'npm.cmd':'npm',args:['run',match[1]]};
}
function createRepairActuator({token,repository,branch,baseSha,failureCode,command}) {
  if(!token)throw crucibleError('CRU-0050', 'CRUCIBLE_REPAIR_TOKEN is required for an authorized cross-repository repair.');
  if(!/^\S+\/\S+$/.test(repository))throw crucibleError('CRU-0050', 'A full GitHub repository name is required.');
  if(!/^[a-f0-9]{40}$/.test(baseSha))throw crucibleError('CRU-0050', 'The repair actuator requires the exact PR head SHA.');
  const parsed=parseRepairCommand(command);
  return {async run({projectId,boundary,changeBaseSha256}) {
    if(projectId!==`github:${repository}`)throw crucibleError('CRU-0050', 'Repair actuator project identity mismatch.');
    if(changeBaseSha256&&changeBaseSha256!==sha256(baseSha))throw crucibleError('CRU-0050', 'Repair actuator base SHA does not match the authorized exact tip.');
    const worktree=fs.mkdtempSync(path.join(os.tmpdir(),'crucible-pr-repair-'));
    try {
      const env={...process.env,GIT_TERMINAL_PROMPT:'0'};
      const url=`https://github.com/${repository}.git`;
      git(worktree,['init','-q'],env);git(worktree,['remote','add','origin',url],env);
      git(worktree,['-c',`http.extraheader=Authorization: Bearer ${token}`,'fetch','--depth=1','origin',baseSha],env);
      git(worktree,['checkout','-q','-b',branch,'FETCH_HEAD'],env);
      const before=git(worktree,['rev-parse','HEAD'],env).trim();
      if(before!==baseSha)throw crucibleError('CRU-0050', `Fetched repair tip ${before} does not equal authorized tip ${baseSha}.`);
      const plan={command,failureCode,boundary,before};
      run(parsed.executable,parsed.args,worktree,env);
      const status=git(worktree,['status','--porcelain'],env);
      if(!status.trim())return{state:'no-change',repository,branch,baseSha,failureCode,plan,applied:{resultSha256:sha256({before,status})}};
      git(worktree,['add','--all'],env);
      git(worktree,['-c','user.name=The Crucible','-c','user.email=crucible@users.noreply.github.com','commit','-m',`Crucible authorized repair: ${failureCode}`],env);
      const repairSha=git(worktree,['rev-parse','HEAD'],env).trim();
      git(worktree,['-c',`http.extraheader=Authorization: Bearer ${token}`,'push','origin',`HEAD:${branch}`],env);
      return{state:'applied',repository,branch,baseSha,repairSha,failureCode,plan,applied:{resultSha256:sha256({before,repairSha,failureCode})}};
    } finally { fs.rmSync(worktree,{recursive:true,force:true}); }
  }};
}
async function githubJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, { headers: {
    accept:'application/vnd.github+json',
    'x-github-api-version':'2022-11-28',
    authorization:`Bearer ${token}`,
  }});
  const body=await response.json();
  if(!response.ok)throw crucibleError('CRU-0050', `GitHub API ${response.status}: ${body.message||'request failed'}`);
  return body;
}
async function waitForRetest({fetchImpl,repository,sha,token,timeoutMs=10*60*1000,pollMs=15000}) {
  const started=Date.now();
  let last=[];
  while(Date.now()-started<timeoutMs){
    const body=await githubJson(fetchImpl,`https://api.github.com/repos/${repository}/commits/${sha}/check-runs?per_page=100`,token);
    last=body.check_runs||[];
    if(last.length && last.every(check=>check.status==='completed')){
      const failing=last.filter(check=>check.conclusion!=='success'&&check.conclusion!=='skipped');
      return {state:failing.length?'failed':'passed',sha,checks:last.map(check=>({id:check.id,name:check.name,status:check.status,conclusion:check.conclusion,url:check.html_url||check.details_url||null})),failing:failing.map(check=>check.name)};
    }
    await new Promise(resolve=>setTimeout(resolve,pollMs));
  }
  return {state:'timed-out',sha,checks:last.map(check=>({id:check.id,name:check.name,status:check.status,conclusion:check.conclusion,url:check.html_url||check.details_url||null})),failing:[]};
}
function buildDefaultPipelineDependencies({fetchImpl=globalThis.fetch,token,repository,root}) {
  const projectId=`github:${repository}`;
  const learningStore=new DurableScientificLearningStore({root:path.join(root,'authorized-repair-learning'),projectId});
  const diagnosticPlanner={async plan(payload){return {bounded:true,nextAction:'diagnose',changeBaseSha256:payload.changeBaseSha256,testRequest:null};}};
  const diagnosticOrgan=async payload=>diagnose({
    projectId,
    repository,
    commitSha: payload.commitSha || payload.headSha || payload.changeBaseSha || '0000000000000000000000000000000000000000',
    runId: payload.runId || 'authorized-pr-repair',
    workflow: payload.workflow || 'Crucible authorized repair',
    job: payload.job || 'production-organism',
    step: payload.step || 'authorized repair diagnosis',
    os: process.platform,
    nodeVersion: process.version,
    conclusion: 'failure',
    log: String(payload.errorLog || payload.finding?.output?.text || payload.finding?.output?.summary || payload.finding?.output?.title || payload.failureCode || ''),
  });
  const experienceRecorder={async record(payload){return {recorded:true,classification:'Insufficient Evidence',promotionAuthorized:false,payloadSha256:sha256(payload)};}};
  const reporter={async report(payload){return {reported:true,payloadSha256:sha256(payload)};}};
  const digestiveWorker={async process(payload){return {observed:false,payloadSha256:sha256(payload)};}};
  const testingOrgan=async({payload})=>{
    const result=payload.repairResult;
    if(!result?.repairSha)return {result:{state:'not-retested',reason:'repair produced no new commit'}};
    return {result:await waitForRetest({fetchImpl,repository,sha:result.repairSha,token})};
  };
  const oversightReflex=new ExternalOversightReflex({projectId,oversightPublicKey:null,ownerPublicKey:null});
  return {learningStore,diagnosticPlanner,diagnosticOrgan,experienceRecorder,reporter,digestiveWorker,testingOrgan,oversightReflex};
}
async function executeAuthorizedRepair({repository,pullRequest,headSha,branch,failure,authorization,token,fetchImpl=globalThis.fetch,diagnosticPlanner,experienceRecorder,reporter,digestiveWorker,testingOrgan,diagnosticOrgan,learningStore,oversightReflex,root=process.cwd(),now=()=>new Date().toISOString()}) {
  if(failure.locked)return{state:'locked-read-only',authorized:false,reason:'locked-pull-request'};
  const authorizationResult=verifyAuthorization({authorization,repository,pullRequest,headSha,failureCode:failure.code,now:new Date(now())});
  if(!authorizationResult.authorized)return{state:'not-authorized',authorized:false,reason:authorizationResult.reason};
  const remedy=failure.remedy;
  if(!remedy||remedy.kind!=='automatic'||!remedy.command)return{state:'not-repairable-by-immune-system',authorized:true,reason:'failure-remedy-is-not-a-concrete-automatic-repair'};
  const deps={learningStore,diagnosticPlanner,diagnosticOrgan,experienceRecorder,reporter,digestiveWorker,testingOrgan,oversightReflex};
  const defaults=buildDefaultPipelineDependencies({fetchImpl,token,repository,root});
  for (const key of Object.keys(defaults)) if (deps[key] == null) deps[key]=defaults[key];
  const actuator=createRepairActuator({token,repository,branch,baseSha:headSha,failureCode:failure.code,command:remedy.command});
  const organism=createProductionOrganism({projectId:`github:${repository}`,root,learningStore:deps.learningStore,oversightReflex:deps.oversightReflex,diagnosticPlanner:deps.diagnosticPlanner,repairActuator:actuator,experienceRecorder:deps.experienceRecorder,reporter:deps.reporter,digestiveWorker:deps.digestiveWorker,testingOrgan:deps.testingOrgan,diagnosticOrgan:deps.diagnosticOrgan,now});
  const submission=await submitNervousObservation(organism,{observationId:`pr-${pullRequest}-${headSha}-${failure.code}`,boundary:`github-pr:${repository}#${pullRequest}`,finding:failure.finding,failureCode:failure.code,commitSha:headSha,headSha,errorLog:failure.finding?.output?.text||failure.finding?.output?.summary||failure.code,changeBaseSha256:sha256(headSha)});
  let heartbeat=await organism.heartbeat();
  for(let i=0;i<4&&heartbeat.results?.some(r=>r.output?.signals);i++)heartbeat=await organism.heartbeat();
  return{state:'repair-pipeline-complete',authorized:true,authorizationId:authorizationResult.authorizationId,authorizationExpiresAt:authorizationResult.expiresAt,failureCode:failure.code,submission,heartbeat};
}
module.exports={DEFAULT_AUTH_FILE,sha256,authorizationScope,readAuthorization,verifyAuthorization,parseRepairCommand,createRepairActuator,githubJson,waitForRetest,buildDefaultPipelineDependencies,executeAuthorizedRepair};
