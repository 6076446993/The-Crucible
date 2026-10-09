'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertExecutionContext, recoveryManifest } = require('../src/keyManagerPolicy');

const good = { GITHUB_REPOSITORY: '6076446993/The-Crucible', GITHUB_REF: 'refs/heads/development', GITHUB_EVENT_NAME: 'workflow_dispatch' };

test('key manager accepts only the exact repository, development ref and manual dispatch', () => {
  assert.deepEqual(assertExecutionContext(good), { repository: good.GITHUB_REPOSITORY, ref: good.GITHUB_REF, event: good.GITHUB_EVENT_NAME, backend: 'github-app' });
  assert.throws(() => assertExecutionContext({ ...good, GITHUB_REPOSITORY: 'other/repo' }), /KEY_MANAGER_REPOSITORY_MISMATCH/);
  assert.throws(() => assertExecutionContext({ ...good, GITHUB_REF: 'refs/heads/main' }), /KEY_MANAGER_BRANCH_MISMATCH/);
  assert.throws(() => assertExecutionContext({ ...good, GITHUB_EVENT_NAME: 'push' }), /KEY_MANAGER_MANUAL_DISPATCH_REQUIRED/);
});

test('external KMS is an explicit capability boundary until a broker is configured', () => {
  assert.throws(() => assertExecutionContext({ ...good, CRUCIBLE_KEY_MANAGER_BACKEND: 'external-kms' }), /KEY_MANAGER_EXTERNAL_KMS_NOT_CONFIGURED/);
});

test('recovery manifest is redacted and explicitly excludes R8', () => {
  const report = recoveryManifest({ mode: 'bootstrap', context: assertExecutionContext(good), plans: [{ registryName: 'raw-intake', current: { id: 'id', sha256: 'a'.repeat(64) }, previous: null }] });
  assert.equal(report.r8, 'excluded');
  assert.equal(Object.prototype.hasOwnProperty.call(report.families[0], 'base64'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report.families[0], 'key'), false);
});
