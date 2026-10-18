'use strict';
// Static bounded inspection only. Cannot run GitHub Actions or read secrets.
const fs = require('node:fs');
function inspectWorkflow(text){
  if(typeof text!=='string' || text.length>200000 || !(text.includes('source-bundle-key-manager') || text.includes('name: Manage Crucible custody keys'))) throw new Error('UNRECOGNIZED_KEY_MANAGER_WORKFLOW');
  const secretAt=text.search(/\bgh\s+secret\s+set\b/);
  const registryAt=text.search(/\bgit\s+push\s+origin\s+HEAD:development\b/);
  const handoffAt=text.search(/\bgit\s+add\b[^\n]*\bAI-HANDOFF\.json\b/);
  const devlogAt=text.search(/\bgit\s+add\b[^\n]*\bDEVLOG\.md\b/);
  const findings=[];
  if(secretAt<0 || registryAt<0)findings.push('UNPROVEN_SECRET_OR_REGISTRY_COMMIT_ORDER');
  else if(secretAt<registryAt)findings.push('SECRET_MUTATION_PRECEDES_REGISTRY_PUBLICATION');
  // Commit may be governance-compliant via an orchestrator elsewhere; demand independent proof.
  if(handoffAt<0 || devlogAt<0)findings.push('COORDINATED_HANDOFF_DEVLOG_WRITE_NOT_EVIDENCED');
  return {
    inspection:'read-only-heuristic',
    findings,
    riskHeld:findings.length>0,
    evidenceOnly:true,
    liveWorkflowSafeToDispatch:false,
    acceptance:'NOT_ESTABLISHED'
  };
}
if(require.main===module){try{const f=process.argv[2];if(!f)throw new Error('WORKFLOW_FILE_REQUIRED');const x=inspectWorkflow(fs.readFileSync(f,'utf8'));console.log(JSON.stringify(x,null,2));process.exitCode=x.riskHeld?2:0;}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={inspectWorkflow};
