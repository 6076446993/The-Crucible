'use strict';

// Non-secret key lifecycle guard. Secret values remain in the runner secret
// store; this module only compares their length and SHA-256 fingerprint with
// checked-in rotation metadata before any custody operation starts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_REGISTRY = path.join(__dirname, '..', 'governingDocuments', 'source-bundle-key-registry.json');
const FAMILIES = {
  raw: { current: 'CRUCIBLE_SOURCE_BUNDLE_KEY', previous: 'CRUCIBLE_SOURCE_BUNDLE_KEY_PREVIOUS', registry: 'raw-intake' },
  vetted: { current: 'CRUCIBLE_VETTED_BUNDLE_KEY', previous: 'CRUCIBLE_VETTED_BUNDLE_KEY_PREVIOUS', registry: 'oversight-vetted' },
};
const RUNNER_INTEGRATION = Object.freeze({
  id: 'nexus-coding-gateway',
  repository: '6076446993/Nexus',
  ref: 'refs/heads/Development-branch',
  audience: 'crucible-nexus-coding',
  authentication: 'github-oidc',
  staticCredentialEnv: null,
});

function readRegistry(file = DEFAULT_REGISTRY) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || value.schemaVersion !== 1 || !value.families) throw new Error('Key registry is invalid: expected schemaVersion 1 and families.');
  return value;
}

function decodeKey(value, name) {
  if (!value) return null;
  let key;
  try { key = Buffer.from(value, 'base64'); } catch { throw new Error(`${name} is not valid base64.`); }
  if (key.length !== 32) throw new Error(`${name} must decode to exactly 32 bytes.`);
  return key;
}

function fingerprint(key) { return crypto.createHash('sha256').update(key).digest('hex'); }

function inspect(familyName, env = process.env, registryFile = DEFAULT_REGISTRY) {
  const family = FAMILIES[familyName];
  if (!family) throw new Error(`Unknown key family: ${familyName}.`);
  const registry = readRegistry(registryFile);
  const metadata = registry.families[family.registry];
  if (!metadata || !metadata.current || !metadata.current.id || !/^[a-f0-9]{64}$/.test(metadata.current.sha256)) {
    throw new Error(`Key registry entry ${family.registry} is incomplete; record a non-secret key id and SHA-256 fingerprint before use.`);
  }
  const current = decodeKey(env[family.current], family.current);
  if (!current) throw new Error(`${family.current} is missing; custody is blocked before decrypt/re-encrypt.`);
  const currentFingerprint = fingerprint(current);
  if (currentFingerprint !== metadata.current.sha256) {
    throw new Error(`${family.current} fingerprint does not match registered key id ${metadata.current.id}; update rotation metadata through the governed process.`);
  }
  const previous = decodeKey(env[family.previous], family.previous);
  if (previous && metadata.previous && metadata.previous.sha256 && fingerprint(previous) !== metadata.previous.sha256) {
    throw new Error(`${family.previous} fingerprint does not match registered previous key id ${metadata.previous.id || 'unknown'}.`);
  }
  return { family: family.registry, currentKeyId: metadata.current.id, currentFingerprint, previousConfigured: Boolean(previous) };
}

// The coding runner is a machine identity, not another long-lived secret.
// It may run only in the exact Nexus repository/ref with a GitHub OIDC token
// minted for the registered audience. Static bearer/key fallbacks are rejected.
function inspectRunner(env = process.env) {
  const repositoryOk = env.GITHUB_REPOSITORY === RUNNER_INTEGRATION.repository;
  const refOk = env.GITHUB_REF === RUNNER_INTEGRATION.ref;
  const oidcOk = Boolean(env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
  const audienceOk = (env.CRUCIBLE_CODING_GATE_AUDIENCE || RUNNER_INTEGRATION.audience) === RUNNER_INTEGRATION.audience;
  const staticCredentialPresent = Boolean(env.CRUCIBLE_CODING_GATE_TOKEN || env.CRUCIBLE_CODING_GATE_KEY);
  if (!repositoryOk) throw new Error('CODING_RUNNER_REPOSITORY_MISMATCH');
  if (!refOk) throw new Error('CODING_RUNNER_BRANCH_MISMATCH');
  if (!oidcOk) throw new Error('CODING_RUNNER_OIDC_UNAVAILABLE');
  if (!audienceOk) throw new Error('CODING_RUNNER_AUDIENCE_MISMATCH');
  if (staticCredentialPresent) throw new Error('CODING_RUNNER_STATIC_CREDENTIAL_FORBIDDEN');
  return { integration: RUNNER_INTEGRATION.id, repository: RUNNER_INTEGRATION.repository, ref: RUNNER_INTEGRATION.ref, audience: RUNNER_INTEGRATION.audience, authentication: RUNNER_INTEGRATION.authentication };
}

function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'runner-preflight') {
    process.stdout.write(`${JSON.stringify(inspectRunner(process.env))}\n`);
    return;
  }
  if (argv[0] !== 'preflight' || !argv[1]) throw new Error('Usage: sourceBundleKeyManager.js preflight <raw|vetted> [registry-path] | runner-preflight');
  const result = inspect(argv[1], process.env, argv[2] ? path.resolve(argv[2]) : DEFAULT_REGISTRY);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = { FAMILIES, RUNNER_INTEGRATION, readRegistry, decodeKey, fingerprint, inspect, inspectRunner };
if (require.main === module) {
  try { main(); } catch (error) { console.error(`KEY_PREFLIGHT_FAILED: ${error.message}`); process.exitCode = 1; }
}
