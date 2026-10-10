'use strict';

const EXPECTED_REPOSITORY = '6076446993/The-Crucible';
const EXPECTED_REF = 'refs/heads/development';

function assertExecutionContext(env = process.env) {
  if (env.GITHUB_REPOSITORY !== EXPECTED_REPOSITORY) throw new Error('KEY_MANAGER_REPOSITORY_MISMATCH');
  if (env.GITHUB_REF !== EXPECTED_REF) throw new Error('KEY_MANAGER_BRANCH_MISMATCH');
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('KEY_MANAGER_MANUAL_DISPATCH_REQUIRED');
  const backend = env.CRUCIBLE_KEY_MANAGER_BACKEND || 'github-app';
  if (backend === 'external-kms') throw new Error('KEY_MANAGER_EXTERNAL_KMS_NOT_CONFIGURED');
  if (backend !== 'github-app') throw new Error('KEY_MANAGER_BACKEND_INVALID');
  return { repository: EXPECTED_REPOSITORY, ref: EXPECTED_REF, event: 'workflow_dispatch', backend };
}

function recoveryManifest({ mode, context, plans }) {
  return {
    schemaVersion: 1,
    purpose: 'Redacted custody-key lifecycle evidence; no secret values or plaintext state.',
    mode,
    context,
    families: plans.map(item => ({
      family: item.registryName,
      currentKeyId: item.current.id,
      currentFingerprint: item.current.sha256,
      previousConfigured: Boolean(item.previous),
      invalidExistingReplaced: Boolean(item.replacedInvalid),
    })),
    r8: 'excluded',
  };
}

module.exports = { EXPECTED_REPOSITORY, EXPECTED_REF, assertExecutionContext, recoveryManifest };
