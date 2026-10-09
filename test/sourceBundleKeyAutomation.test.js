'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildPlan, applyRegistry, writePlan } = require('../src/sourceBundleKeyAutomation');

function registryFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-key-manager-'));
  const file = path.join(dir, 'registry.json');
  fs.copyFileSync(path.join(__dirname, '..', 'governingDocuments', 'source-bundle-key-registry.json'), file);
  return { dir, file };
}

test('bootstrap generates two 32-byte keys and redacted metadata', () => {
  const { dir, file } = registryFile();
  const plan = buildPlan({ registryFile: file, env: {}, mode: 'bootstrap' });
  assert.equal(plan.plans.length, 2);
  for (const item of plan.plans) {
    assert.equal(Buffer.from(item.current.base64, 'base64').length, 32);
    assert.match(item.current.id, /^crucible-(raw|vetted)-[a-f0-9]{16}$/);
  }
  const output = path.join(dir, 'secrets');
  writePlan(plan, output, file);
  const persisted = fs.readFileSync(file, 'utf8');
  for (const item of plan.plans) {
    assert.doesNotMatch(persisted, new RegExp(item.current.base64.replace(/[+/=]/g, '\\$&')));
  }
  assert.ok(fs.existsSync(path.join(output, 'CRUCIBLE_SOURCE_BUNDLE_KEY')));
});

test('rotation requires existing keys and moves current metadata to previous', () => {
  const { file } = registryFile();
  const raw = crypto.randomBytes(32).toString('base64');
  const vetted = crypto.randomBytes(32).toString('base64');
  const plan = buildPlan({ registryFile: file, env: { CRUCIBLE_SOURCE_BUNDLE_KEY: raw, CRUCIBLE_VETTED_BUNDLE_KEY: vetted }, mode: 'rotate' });
  const updated = applyRegistry(plan);
  assert.equal(updated.families['raw-intake'].previous.sha256, crypto.createHash('sha256').update(Buffer.from(raw, 'base64')).digest('hex'));
  assert.equal(updated.families['oversight-vetted'].previous.sha256, crypto.createHash('sha256').update(Buffer.from(vetted, 'base64')).digest('hex'));
});

test('rotation fails closed when either current key is unavailable', () => {
  const { file } = registryFile();
  assert.throws(() => buildPlan({ registryFile: file, env: {}, mode: 'rotate' }), /KEY_MANAGER_ROTATION_REQUIRES_EXISTING_KEY/);
});

test('plan output contains no key material or R8 behavior', () => {
  const { file } = registryFile();
  const plan = buildPlan({ registryFile: file, env: {}, mode: 'bootstrap' });
  const text = JSON.stringify({ mode: plan.mode, families: plan.plans.map(p => ({ id: p.current.id, sha256: p.current.sha256 })) });
  assert.doesNotMatch(text, /R8|executable|base64/i);
});
