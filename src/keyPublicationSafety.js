'use strict';
// Deliberate emergency stop for the existing GitHub Secrets + Git push workflow.
// Not a replacement KMS. GitHub secret-set and git-push are not one transaction.
const crypto=require('node:crypto'), fs=require('node:fs'),path=require('node:path');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const HEX=/^[a-f0-9]{64}$/;
function inspectPublication({policy,existingRegistry,history=[],mode}) {
  const reasons=[];
  if (!policy || policy.mode!=='normal' || policy.independentRecoveryAccepted!==true || policy.normalWorkResumptionAuthorized!==true) reasons.push('P0_RECOVERY_ONLY_OR_INDEPENDENT_RESTORE_NOT_ACCEPTED');
  if (!existingRegistry || existingRegistry.schemaVersion!==1 || !existingRegistry.families) reasons.push('MISSING_CANONICAL_REGISTRY');
  if (!Array.isArray(history)||!history.length) reasons.push('MISSING_COMPLETE_HISTORY');
  if (!['register','bootstrap','rotate'].includes(mode)) reasons.push('UNKNOWN_MODE');
  if (history.some(h=>!h.family||!HEX.test(h.sha256||''))) reasons.push('MALFORMED_HISTORY');
  if (existingRegistry?.families?.['oversight-vetted']?.current?.id==='REQUIRED_OWNER_KEY_ID') reasons.push('VETTED_OWNER_IDENTITY_NOT_REGISTERED');
  // A non-secret key fingerprint or a Git commit is not a recoverable secret.
  reasons.push('VERSIONED_KMS_ATOMIC_POINTER_AND_INDEPENDENT_ESCROW_NOT_INSTALLED');
  return Object.freeze({state:'BLOCKED',mode,reasons:[...new Set(reasons)],safeToMutate:false,
    attemptedKeyRotation:false,attemptedSecretUpdate:false,attemptedRegistryPush:false});
}
function enforceCurrentWorkflow({policyFile,registryFile,mode,history=[]}={}){
  const policy=JSON.parse(fs.readFileSync(path.resolve(policyFile),'utf8'));
  const existingRegistry=JSON.parse(fs.readFileSync(path.resolve(registryFile),'utf8'));
  return inspectPublication({policy,existingRegistry,history,mode});
}
if(require.main===module){
  try{
    const root=path.join(__dirname,'..');
    const result=enforceCurrentWorkflow({policyFile:process.env.CRUCIBLE_RECOVERY_POLICY_FILE||path.join(root,'governingDocuments/recovery-operation-policy.json'),registryFile:process.env.CRUCIBLE_KEY_REGISTRY_FILE||path.join(root,'governingDocuments/source-bundle-key-registry.json'),mode:process.env.CRUCIBLE_KEY_MANAGER_MODE||'register'});
    console.error(`KEY_PUBLICATION_BLOCKED:${result.reasons.join(',')}`);
    process.exitCode=2; // no secret values printed
  }catch(error){console.error(`KEY_PUBLICATION_BLOCKED:INVALID_PREFLIGHT:${error.code||'error'}`);process.exitCode=2;}
}
module.exports={inspectPublication,enforceCurrentWorkflow,sha};
