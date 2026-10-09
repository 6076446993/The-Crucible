'use strict';

// Automated custody-key bootstrap/rotation. Secret values exist only in the
// process and runner temporary directory; this module emits fingerprints and
// key ids, never key material.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { FAMILIES, readRegistry, fingerprint, decodeKey } = require('./sourceBundleKeyManager');
const { assertExecutionContext, recoveryManifest } = require('./keyManagerPolicy');

function keyId(family, sha256) { return `crucible-${family}-${sha256.slice(0, 16)}`; }

function generateKey(randomBytes = crypto.randomBytes) {
  const key = randomBytes(32);
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('KEY_MANAGER_RANDOM_SOURCE_INVALID');
  const sha256 = fingerprint(key);
  return { key, base64: key.toString('base64'), sha256 };
}

function familyPlan(name, env, registry) {
  const family = FAMILIES[name];
  const registered = registry.families[family.registry];
  const existing = env[family.current] ? decodeKey(env[family.current], family.current) : null;
  const next = generateKey();
  const previous = existing ? { key: existing, base64: existing.toString('base64'), sha256: fingerprint(existing), id: registered.current.id } : null;
  return {
    registryName: family.registry,
    currentSecret: family.current,
    previousSecret: family.previous,
    current: { id: keyId(name, next.sha256), sha256: next.sha256, key: next.key, base64: next.base64 },
    previous,
  };
}

function buildPlan({ env = process.env, registryFile, mode = 'bootstrap' } = {}) {
  if (!['bootstrap', 'rotate'].includes(mode)) throw new Error('KEY_MANAGER_MODE_INVALID');
  const registry = readRegistry(registryFile);
  const plans = ['raw', 'vetted'].map(name => familyPlan(name, env, registry));
  if (mode === 'rotate') {
    for (const plan of plans) if (!plan.previous) throw new Error(`KEY_MANAGER_ROTATION_REQUIRES_EXISTING_KEY:${plan.currentSecret}`);
  }
  return { mode, plans, registry };
}

function applyRegistry(plan) {
  for (const item of plan.plans) {
    const entry = plan.registry.families[item.registryName];
    entry.previous = item.previous ? { id: item.previous.id, sha256: item.previous.sha256 } : null;
    entry.current = { id: item.current.id, sha256: item.current.sha256 };
    entry.rotation = { status: plan.mode === 'rotate' ? 'rotated-by-automated-key-manager' : 'bootstrapped-by-automated-key-manager', dualKeyWindowRequired: true };
  }
  return plan.registry;
}

function writePlan(plan, outputDir, registryFile, context = null) {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const item of plan.plans) {
    fs.writeFileSync(path.join(outputDir, item.currentSecret), `${item.current.base64}\n`, { mode: 0o600 });
    if (item.previous) fs.writeFileSync(path.join(outputDir, item.previousSecret), `${item.previous.base64}\n`, { mode: 0o600 });
  }
  if (context) fs.writeFileSync(path.join(outputDir, 'key-manager-report.json'), `${JSON.stringify(recoveryManifest({ mode: plan.mode, context, plans: plan.plans }), null, 2)}\n`);
  fs.writeFileSync(registryFile, `${JSON.stringify(applyRegistry(plan), null, 2)}\n`);
}

function main(argv = process.argv.slice(2)) {
  if (argv[0] !== 'generate') throw new Error('Usage: sourceBundleKeyAutomation.js generate --output-dir DIR --registry PATH [--mode bootstrap|rotate]');
  const arg = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
  const outputDir = path.resolve(arg('--output-dir', process.env.RUNNER_TEMP ? path.join(process.env.RUNNER_TEMP, 'crucible-key-manager') : 'key-manager-output'));
  const registryFile = path.resolve(arg('--registry', path.join(__dirname, '..', 'governingDocuments', 'source-bundle-key-registry.json')));
  const context = assertExecutionContext(process.env);
  const plan = buildPlan({ registryFile, mode: arg('--mode', 'bootstrap') });
  writePlan(plan, outputDir, registryFile, context);
  process.stdout.write(JSON.stringify({ mode: plan.mode, families: plan.plans.map(p => ({ family: p.registryName, currentKeyId: p.current.id, currentFingerprint: p.current.sha256, previousConfigured: Boolean(p.previous) })) }) + '\n');
}

module.exports = { keyId, generateKey, buildPlan, applyRegistry, writePlan };
if (require.main === module) { try { main(); } catch (error) { console.error(`KEY_MANAGER_FAILED: ${error.message}`); process.exitCode = 1; } }
