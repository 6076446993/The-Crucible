'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {inspectPublication,enforceCurrentWorkflow}=require('../src/keyPublicationSafety');
const root=path.join(__dirname,'..');const p=JSON.parse(fs.readFileSync(path.join(root,'governingDocuments/recovery-operation-policy.json')));
const reg=JSON.parse(fs.readFileSync(path.join(root,'governingDocuments/source-bundle-key-registry.json')));
for(const mode of ['register','bootstrap','rotate'])test(`${mode} prohibited during current recovery-only hold`,()=>{
 const r=inspectPublication({mode,policy:p,existingRegistry:reg,history:[{family:'raw-intake',sha256:'a'.repeat(64)}]});
 assert.equal(r.safeToMutate,false);assert.ok(r.reasons.includes('P0_RECOVERY_ONLY_OR_INDEPENDENT_RESTORE_NOT_ACCEPTED'));
 assert.equal(r.attemptedKeyRotation,false);assert.equal(r.attemptedRegistryPush,false);
});
test('even false acceptance cannot allow unaudited GitHub secret write',()=>{
 const r=inspectPublication({mode:'rotate',policy:{mode:'normal',independentRecoveryAccepted:true,normalWorkResumptionAuthorized:true},existingRegistry:reg,history:[{family:'raw-intake',sha256:'a'.repeat(64)}]});
 assert.equal(r.safeToMutate,false);assert.match(r.reasons.join(' '),/VERSIONED_KMS/);
});
test('must not let a placeholder VETTED key identity appear registered',()=>assert.ok(inspectPublication({mode:'register',policy:p,existingRegistry:reg}).reasons.includes('VETTED_OWNER_IDENTITY_NOT_REGISTERED')));
test('CLI preflight reports blocked on actual isolated recovery policy',()=>{
 const r=enforceCurrentWorkflow({mode:'register',policyFile:path.join(root,'governingDocuments/recovery-operation-policy.json'),registryFile:path.join(root,'governingDocuments/source-bundle-key-registry.json')});
 assert.equal(r.state,'BLOCKED');
});

test('workflow guard precedes generation and every secret or metadata publication',()=>{
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/source-bundle-key-manager.yml'),'utf8');
 const guard=workflow.indexOf('run: node src/keyPublicationSafety.js');
 assert.ok(guard>=0);
 for(const operation of ['- name: Register, generate, or rotate custody keys','node src/sourceBundleKeyAutomation.js','gh secret set','git push']){
  const index=workflow.indexOf(operation);
  assert.ok(index>guard,`${operation} must remain after the failing guard`);
 }
 const nextStep=workflow.slice(guard,workflow.indexOf('gh secret set'));
 assert.doesNotMatch(nextStep,/continue-on-error:\s*true|if:\s*(?:\$\{\{\s*)?always\(/);
});

test('actual guard process blocks all modes without printing synthetic key values',()=>{
 const {spawnSync}=require('node:child_process');
 const syntheticKey=Buffer.alloc(32,73).toString('base64');
 for(const mode of ['register','bootstrap','rotate']){
  const result=spawnSync(process.execPath,[path.join(root,'src/keyPublicationSafety.js')],{encoding:'utf8',env:{...process.env,CRUCIBLE_KEY_MANAGER_MODE:mode,CRUCIBLE_SOURCE_BUNDLE_KEY:syntheticKey}});
  assert.equal(result.status,2);
  assert.match(result.stderr,/KEY_PUBLICATION_BLOCKED:/);
  assert.ok(!(result.stdout+result.stderr).includes(syntheticKey));
 }
});

test('invalid configuration fails closed with redacted diagnostics',t=>{
 const os=require('node:os'),{spawnSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crucible-invalid-key-policy-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'policy.json');
 const marker='synthetic-private-material-must-never-be-logged';
 fs.writeFileSync(file,`{${marker}`);
 const result=spawnSync(process.execPath,[path.join(root,'src/keyPublicationSafety.js')],{encoding:'utf8',env:{...process.env,CRUCIBLE_RECOVERY_POLICY_FILE:file}});
 assert.equal(result.status,2);
 assert.match(result.stderr,/INVALID_PREFLIGHT/);
 assert.ok(!(result.stdout+result.stderr).includes(marker));
});
