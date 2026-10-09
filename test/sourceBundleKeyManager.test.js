'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspect, inspectRunner, fingerprint } = require('../src/sourceBundleKeyManager');

function registry(dir, current, previous = null) {
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, families: { 'raw-intake': { current: { id: 'raw-1', sha256: fingerprint(current) }, previous: previous ? { id: 'raw-0', sha256: fingerprint(previous) } : null } } }));
  return file;
}

test('preflight validates the current key without exposing it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-key-'));
  const key = crypto.randomBytes(32);
  const result = inspect('raw', { CRUCIBLE_SOURCE_BUNDLE_KEY: key.toString('base64') }, registry(dir, key));
  assert.equal(result.currentKeyId, 'raw-1');
  assert.equal(result.currentFingerprint, fingerprint(key));
});

test('preflight fails closed when the secret is missing or mismatched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-key-'));
  const key = crypto.randomBytes(32);
  const file = registry(dir, key);
  assert.throws(() => inspect('raw', {}, file), /CRUCIBLE_SOURCE_BUNDLE_KEY is missing/);
  assert.throws(() => inspect('raw', { CRUCIBLE_SOURCE_BUNDLE_KEY: crypto.randomBytes(32).toString('base64') }, file), /fingerprint does not match/);
});

test('coding runner requires exact Nexus OIDC context and rejects static credentials', () => {
  const base = { GITHUB_REPOSITORY: '6076446993/Nexus', GITHUB_REF: 'refs/heads/Development-branch', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.invalid', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'redacted', CRUCIBLE_CODING_GATE_AUDIENCE: 'crucible-nexus-coding' };
  assert.equal(inspectRunner(base).integration, 'nexus-coding-gateway');
  assert.throws(() => inspectRunner({ ...base, GITHUB_REF: 'refs/heads/main' }), /CODING_RUNNER_BRANCH_MISMATCH/);
  assert.throws(() => inspectRunner({ ...base, CRUCIBLE_CODING_GATE_TOKEN: 'never-persist' }), /CODING_RUNNER_STATIC_CREDENTIAL_FORBIDDEN/);
});
