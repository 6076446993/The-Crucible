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

const SHA256 = /^[a-f0-9]{64}$/;
function registeredIdentity(entry, family) {
  if (!entry || !entry.current || typeof entry.current.id !== 'string' ||
      typeof entry.current.sha256 !== 'string') {
    throw new Error(`KEY_MANAGER_REGISTRY_INVALID:${family}`);
  }
  const { id, sha256 } = entry.current;
  if (id.startsWith('REQUIRED_') && sha256.startsWith('REQUIRED_')) return null;
  if (!id || id.startsWith('REQUIRED_') || !SHA256.test(sha256)) {
    throw new Error(`KEY_MANAGER_PARTIAL_CURRENT_METADATA:${family}`);
  }
  return { id, sha256 };
}
function validatePreviousMetadata(entry, family) {
  if (entry.previous == null) return null;
  const previous = entry.previous;
  if (typeof previous.id !== 'string' || !previous.id || previous.id.startsWith('REQUIRED_') ||
      typeof previous.sha256 !== 'string' || !SHA256.test(previous.sha256)) {
    throw new Error(`KEY_MANAGER_PREVIOUS_METADATA_INVALID:${family}`);
  }
  return previous;
}

function generateKey(randomBytes = crypto.randomBytes) {
  const key = randomBytes(32);
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('KEY_MANAGER_RANDOM_SOURCE_INVALID');
  const sha256 = fingerprint(key);
  return { key, base64: key.toString('base64'), sha256 };
}

function familyPlan(name, env, registry, { mode, allowInvalidReplacement = false } = {}) {
  const family = FAMILIES[name];
  const registered = registry.families[family.registry];
  const currentIdentity = registeredIdentity(registered, name);
  const historicalIdentity = validatePreviousMetadata(registered, name);
  if (mode === 'bootstrap' && (currentIdentity || historicalIdentity)) {
    throw new Error(`KEY_MANAGER_BOOTSTRAP_HISTORY_EXISTS:${family.current}`);
  }
  if (mode === 'rotate' && historicalIdentity) {
    // Existing registry tracks one previous generation and the workflow retains
    // only one previous secret. Rotation here could strand older ciphertext.
    throw new Error(`KEY_MANAGER_ROTATION_HISTORICAL_CUSTODY_REQUIRED:${family.current}`);
  }
  let existing = null;
  let replacedInvalid = false;
  if (env[family.current]) {
    try {
      existing = decodeKey(env[family.current], family.current);
    } catch (error) {
      if (!allowInvalidReplacement) {
        throw new Error(`KEY_MANAGER_BOOTSTRAP_REQUIRES_EXPLICIT_INVALID_REPLACEMENT:${family.current}`);
      }
      replacedInvalid = true;
    }
  }
  if (mode === 'bootstrap' && existing) {
    throw new Error(`KEY_MANAGER_BOOTSTRAP_REGISTER_EXISTING_FIRST:${family.current}`);
  }
  if (mode === 'rotate') {
    if (!existing) throw new Error(`KEY_MANAGER_ROTATION_REQUIRES_EXISTING_KEY:${family.current}`);
    if (!currentIdentity) throw new Error(`KEY_MANAGER_ROTATION_REQUIRES_REGISTERED_KEY:${family.current}`);
    if (fingerprint(existing) !== currentIdentity.sha256) {
      throw new Error(`KEY_MANAGER_CURRENT_MISMATCH:${family.current}`);
    }
    // Do not move an untracked prior secret out of reach.
    if (env[family.previous]) throw new Error(`KEY_MANAGER_ROTATION_PREVIOUS_SECRET_UNRECONCILED:${family.previous}`);
  }
  const next = generateKey();
  const previous = existing ? {
    key: existing, base64: existing.toString('base64'),
    sha256: fingerprint(existing), id: currentIdentity.id
  } : null;
  return {
    registryName: family.registry,
    currentSecret: family.current,
    previousSecret: family.previous,
    current: { id: keyId(name, next.sha256), sha256: next.sha256, key: next.key, base64: next.base64 },
    previous,
    replacedInvalid,
  };
}

function registerFamilyPlan(name, env, registry) {
  const family = FAMILIES[name];
  const registered = registry.families[family.registry];
  const existing = decodeKey(env[family.current], family.current);
  if (!existing) throw new Error(`KEY_MANAGER_REGISTER_REQUIRES_EXISTING_KEY:${family.current}`);
  const sha256 = fingerprint(existing);
  const currentIdentity = registeredIdentity(registered, name);
  const historicalIdentity = validatePreviousMetadata(registered, name);
  if (currentIdentity && sha256 !== currentIdentity.sha256) {
    throw new Error(`KEY_MANAGER_REGISTER_CURRENT_MISMATCH:${family.current}`);
  }
  const priorKey = decodeKey(env[family.previous], family.previous);
  if (priorKey && !historicalIdentity) {
    throw new Error(`KEY_MANAGER_PREVIOUS_UNREGISTERED:${family.previous}`);
  }
  if (priorKey && fingerprint(priorKey) !== historicalIdentity.sha256) {
    throw new Error(`KEY_MANAGER_PREVIOUS_MISMATCH:${family.previous}`);
  }
  return {
    registryName: family.registry,
    currentSecret: family.current,
    previousSecret: family.previous,
    current: {
      id: currentIdentity ? currentIdentity.id : keyId(name, sha256),
      sha256,
      key: existing,
      base64: existing.toString('base64'),
    },
    // A missing previous secret is NOT evidence that old custody disappeared.
    // Metadata is deliberately preserved by applyRegistry in register mode.
    previous: priorKey ? { id: historicalIdentity.id, sha256: historicalIdentity.sha256 } : null,
  };
}

function buildPlan({ env = process.env, registryFile, mode = 'bootstrap', family = null, allowInvalidReplacement = false } = {}) {
  if (!['bootstrap', 'rotate', 'register'].includes(mode)) throw new Error('KEY_MANAGER_MODE_INVALID');
  if (mode === 'register' && !['raw', 'vetted'].includes(family)) throw new Error('KEY_MANAGER_REGISTER_FAMILY_REQUIRED');
  const registry = readRegistry(registryFile);
  const names = family ? [family] : ['raw', 'vetted'];
  const plans = names.map(name => mode === 'register'
    ? registerFamilyPlan(name, env, registry)
    : familyPlan(name, env, registry, { mode, allowInvalidReplacement: mode === 'bootstrap' && allowInvalidReplacement }));
  if (mode === 'rotate') {
    for (const plan of plans) if (!plan.previous) throw new Error(`KEY_MANAGER_ROTATION_REQUIRES_EXISTING_KEY:${plan.currentSecret}`);
  }
  return { mode, plans, registry };
}

function applyRegistry(plan) {
  for (const item of plan.plans) {
    const entry = plan.registry.families[item.registryName];
    if (plan.mode === 'register') {
      const recorded = registeredIdentity(entry, item.registryName);
      validatePreviousMetadata(entry, item.registryName);
      if (recorded && (recorded.id !== item.current.id || recorded.sha256 !== item.current.sha256)) {
        throw new Error(`KEY_MANAGER_REGISTER_CURRENT_MISMATCH:${item.currentSecret}`);
      }
      entry.current = { id: item.current.id, sha256: item.current.sha256 };
      // Never reset `previous` or `rotation` during registration.
      continue;
    }
    entry.previous = item.previous ? { id: item.previous.id, sha256: item.previous.sha256 } : null;
    entry.current = { id: item.current.id, sha256: item.current.sha256 };
    entry.rotation = { status: plan.mode === 'rotate' ? 'rotated-by-automated-key-manager' : 'bootstrapped-by-automated-key-manager', dualKeyWindowRequired: true };
  }
  return plan.registry;
}

function writePlan(plan, outputDir, registryFile, context = null) {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const item of plan.plans) if (plan.mode !== 'register') {
    fs.writeFileSync(path.join(outputDir, item.currentSecret), `${item.current.base64}\n`, { mode: 0o600 });
    if (item.previous) fs.writeFileSync(path.join(outputDir, item.previousSecret), `${item.previous.base64}\n`, { mode: 0o600 });
  }
  if (context) fs.writeFileSync(path.join(outputDir, 'key-manager-report.json'), `${JSON.stringify(recoveryManifest({ mode: plan.mode, context, plans: plan.plans }), null, 2)}\n`);
  fs.writeFileSync(registryFile, `${JSON.stringify(applyRegistry(plan), null, 2)}\n`);
}

function main(argv = process.argv.slice(2)) {
  if (argv[0] !== 'generate') throw new Error('Usage: sourceBundleKeyAutomation.js generate --output-dir DIR --registry PATH [--mode bootstrap|rotate|register] [--family raw|vetted]');
  const arg = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
  const outputDir = path.resolve(arg('--output-dir', process.env.RUNNER_TEMP ? path.join(process.env.RUNNER_TEMP, 'crucible-key-manager') : 'key-manager-output'));
  const registryFile = path.resolve(arg('--registry', path.join(__dirname, '..', 'governingDocuments', 'source-bundle-key-registry.json')));
  const context = assertExecutionContext(process.env);
  const plan = buildPlan({
    registryFile,
    mode: arg('--mode', 'bootstrap'),
    family: arg('--family', null),
    allowInvalidReplacement: arg('--allow-invalid-replacement', 'false') === 'true',
  });
  writePlan(plan, outputDir, registryFile, context);
  process.stdout.write(JSON.stringify({ mode: plan.mode, families: plan.plans.map(p => ({ family: p.registryName, currentKeyId: p.current.id, currentFingerprint: p.current.sha256, previousConfigured: Boolean(p.previous) })) }) + '\n');
}

module.exports = { keyId, generateKey, buildPlan, applyRegistry, writePlan };
if (require.main === module) { try { main(); } catch (error) { console.error(`KEY_MANAGER_FAILED: ${error.message}`); process.exitCode = 1; } }
