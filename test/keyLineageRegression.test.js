'use strict';
// Isolated regression tests. Uses synthetic keys only; never reads live credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPlan, applyRegistry, writePlan } = require('../src/sourceBundleKeyAutomation');
const { fingerprint } = require('../src/sourceBundleKeyManager');
const key = () => crypto.randomBytes(32);
const hash = keyBuffer => fingerprint(keyBuffer);
const meta = (name, data) => ({id:`crucible-${name}-${hash(data).slice(0,16)}`,sha256:hash(data)});
const temporaryRoots = [];
test.after(() => {
  for (const dir of temporaryRoots) fs.rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-lineage-regression-'));
  temporaryRoots.push(dir);
  const file=path.join(dir,'registry.json');
  const current=key(), old=key();
  const registry={schemaVersion:1,families:{
    'raw-intake':{current:meta('raw', current),previous:meta('raw',old),rotation:{status:'rotated',dualKeyWindowRequired:true}},
    'oversight-vetted':{current:{id:'REQUIRED_OWNER_KEY_ID',sha256:'REQUIRED_64_HEX_FINGERPRINT'},previous:null,rotation:{status:'blocked'}}
  }};
  fs.writeFileSync(file,JSON.stringify(registry));
  return {dir,file,current,old,registry};
}
test('registration preserves historical key metadata and rotation evidence even without old key secret',()=>{
  const f=fixture(); const baseline=structuredClone(f.registry.families['raw-intake']);
  const p=buildPlan({registryFile:f.file,env:{CRUCIBLE_SOURCE_BUNDLE_KEY:f.current.toString('base64')},mode:'register',family:'raw'});
  const updated=applyRegistry(p);
  assert.deepEqual(updated.families['raw-intake'],baseline);
  writePlan(p,path.join(f.dir,'no-secret-files'),f.file);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file)).families['raw-intake'],baseline);
});
test('registration rejects a different current key instead of relabelling existing identity',()=>{
  const f=fixture();
  assert.throws(()=>buildPlan({registryFile:f.file,env:{CRUCIBLE_SOURCE_BUNDLE_KEY:key().toString('base64')},mode:'register',family:'raw'}),/KEY_MANAGER_REGISTER_CURRENT_MISMATCH/);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file)),f.registry);
});
test('registration checks supplied prior-key material against historical fingerprint',()=>{
  const f=fixture();
  assert.throws(()=>buildPlan({registryFile:f.file,env:{CRUCIBLE_SOURCE_BUNDLE_KEY:f.current.toString('base64'),CRUCIBLE_SOURCE_BUNDLE_KEY_PREVIOUS:key().toString('base64')},mode:'register',family:'raw'}),/KEY_MANAGER_PREVIOUS_MISMATCH/);
});
test('registration tolerates missing prior-key secret but never reports independent recoverability',()=>{
  const f=fixture();
  const p=buildPlan({registryFile:f.file,env:{CRUCIBLE_SOURCE_BUNDLE_KEY:f.current.toString('base64')},mode:'register',family:'raw'});
  assert.equal(Boolean(p.plans[0].previous),false);
  assert.deepEqual(applyRegistry(p).families['raw-intake'].previous,f.registry.families['raw-intake'].previous);
});
test('bootstrap cannot replace a registered current or previous generation',()=>{
  const f=fixture();
  assert.throws(()=>buildPlan({registryFile:f.file,env:{},mode:'bootstrap',family:'raw'}),/KEY_MANAGER_BOOTSTRAP_HISTORY_EXISTS/);
});
test('bootstrap with synthetic fresh empty registry still succeeds',()=>{
  const f=fixture(); f.registry.families['raw-intake']={current:{id:'REQUIRED_OWNER_KEY_ID',sha256:'REQUIRED_64_HEX_FINGERPRINT'},previous:null,rotation:{status:'blocked'}};
  fs.writeFileSync(f.file,JSON.stringify(f.registry));
  const p=buildPlan({registryFile:f.file,env:{},mode:'bootstrap',family:'raw'});
  assert.equal(p.plans.length,1);
  assert.match(p.plans[0].current.sha256,/^[a-f0-9]{64}$/);
});
test('bootstrap refuses replacing even an unregistered existing decodable key',()=>{
  const f=fixture(); f.registry.families['raw-intake']={current:{id:'REQUIRED_OWNER_KEY_ID',sha256:'REQUIRED_64_HEX_FINGERPRINT'},previous:null};
  fs.writeFileSync(f.file,JSON.stringify(f.registry));
  assert.throws(()=>buildPlan({registryFile:f.file,env:{CRUCIBLE_SOURCE_BUNDLE_KEY:f.current.toString('base64')},mode:'bootstrap',family:'raw'}),/KEY_MANAGER_BOOTSTRAP_REGISTER_EXISTING_FIRST/);
});
test('rotation cannot evict a prior generation from one-previous registry',()=>{
  const f=fixture();
  assert.throws(()=>buildPlan({registryFile:f.file,env:{CRUCIBLE_SOURCE_BUNDLE_KEY:f.current.toString('base64')},mode:'rotate',family:'raw'}),/KEY_MANAGER_ROTATION_HISTORICAL_CUSTODY_REQUIRED/);
});
test('rotation may retain validated current as previous only if no prior registered history',()=>{
  const f=fixture(); f.registry.families['raw-intake'].previous=null; fs.writeFileSync(f.file,JSON.stringify(f.registry));
  const p=buildPlan({registryFile:f.file,env:{CRUCIBLE_SOURCE_BUNDLE_KEY:f.current.toString('base64')},mode:'rotate',family:'raw'});
  const updated=applyRegistry(p);
  assert.deepEqual(updated.families['raw-intake'].previous,meta('raw',f.current));
});
test('rotation refuses current-key mismatch even when no previous metadata',()=>{
  const f=fixture(); f.registry.families['raw-intake'].previous=null; fs.writeFileSync(f.file,JSON.stringify(f.registry));
  assert.throws(()=>buildPlan({registryFile:f.file,env:{CRUCIBLE_SOURCE_BUNDLE_KEY:key().toString('base64')},mode:'rotate',family:'raw'}),/KEY_MANAGER_CURRENT_MISMATCH/);
});
test('register of placeholder vetted identity changes no raw or historical fields',()=>{
  const f=fixture();const vetted=key();
  const p=buildPlan({registryFile:f.file,env:{CRUCIBLE_VETTED_BUNDLE_KEY:vetted.toString('base64')},mode:'register',family:'vetted'});
  const updated=applyRegistry(p);
  assert.deepEqual(updated.families['raw-intake'],f.registry.families['raw-intake']);
  assert.deepEqual(updated.families['oversight-vetted'].current,meta('vetted',vetted));
});
test('register rejects corrupt previous metadata instead of silently erasing it',()=>{
  const f=fixture(); f.registry.families['raw-intake'].previous.sha256='bad'; fs.writeFileSync(f.file,JSON.stringify(f.registry));
  assert.throws(()=>buildPlan({registryFile:f.file,env:{CRUCIBLE_SOURCE_BUNDLE_KEY:f.current.toString('base64')},mode:'register',family:'raw'}),/KEY_MANAGER_PREVIOUS_METADATA_INVALID/);
});
test('register refuses unregistered previous secret instead of silently losing its identity',()=>{
  const f=fixture();f.registry.families['raw-intake'].previous=null;fs.writeFileSync(f.file,JSON.stringify(f.registry));
  assert.throws(()=>buildPlan({registryFile:f.file,env:{CRUCIBLE_SOURCE_BUNDLE_KEY:f.current.toString('base64'),CRUCIBLE_SOURCE_BUNDLE_KEY_PREVIOUS:f.old.toString('base64')},mode:'register',family:'raw'}),/KEY_MANAGER_PREVIOUS_UNREGISTERED/);
});
