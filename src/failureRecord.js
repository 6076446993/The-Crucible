'use strict';

const crypto = require('node:crypto');
const { describeCode, crucibleError } = require('./failureCodes');

const SCHEMA_VERSION = 1;
const LIFECYCLE = Object.freeze([
  'observed',
  'investigating',
  'repaired',
  'verified',
  'postmortem',
  'learning-candidate',
  'governed',
  'vetted',
]);

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw crucibleError('CRU-0052', \`\${label} is required for a durable failure record.\`);
  }
  return value.trim();
}

function optionalText(value, label) {
  if (value === undefined || value === null) return null;
  return text(value, label);
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
}

function failureRecordId(input) {
  return \`FR-\${sha256({
    repository: input.repository,
    workflow: input.workflow,
    runId: input.runId,
    jobId: input.jobId,
    check: input.check,
    commit: input.commit,
    failureCode: input.failureCode,
  }).slice(0, 16)}\`;
}

function normalizeFailureEvidence(evidence = []) {
  if (!Array.isArray(evidence)) {
    throw crucibleError('CRU-0052', 'failure evidence must be an array.');
  }
  return evidence.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw crucibleError('CRU-0052', \`failure evidence entry \${index} must be an object.\`);
    }
    return Object.freeze({
      kind: text(item.kind, \`failure evidence[\${index}].kind\`),
      value: text(String(item.value), \`failure evidence[\${index}].value\`),
      source: optionalText(item.source, \`failure evidence[\${index}].source\`),
      sha256: /^[a-f0-9]{64}$/.test(String(item.sha256 || ''))
        ? item.sha256
        : sha256(item.value),
    });
  });
}

function classifyFailureCode(failureCode) {
  if (failureCode === undefined || failureCode === null) {
    return { failureCode: 'CRU-0000', failureCodeStatus: 'uncoded' };
  }
  if (!/^CRU-\\d{4}$/.test(failureCode)) {
    throw crucibleError('CRU-0052', \`Invalid failure code \${failureCode}; expected CRU-####.\`);
  }
  return {
    failureCode,
    failureCodeStatus: describeCode(failureCode) ? 'registered' : 'pending-registration',
  };
}

/**
 * Build the durable boundary between raw CI failure logs and learning custody.
 *
 * This record deliberately does not assert root cause merely because a log contains a
 * plausible phrase. The failure is observed first; investigation, repair and verification
 * are attached later as evidence-backed stages.
 */
function createFailureRecord(input = {}) {
  const code = classifyFailureCode(input.failureCode);
  const repository = text(input.repository, 'repository');
  const commit = text(input.commit, 'commit');
  const evidence = normalizeFailureEvidence(input.evidence);

  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    failureId: failureRecordId({ ...input, repository, commit, failureCode: code.failureCode }),
    failureCode: code.failureCode,
    failureCodeStatus: code.failureCodeStatus,
    repository,
    project: optionalText(input.project, 'project'),
    workflow: optionalText(input.workflow, 'workflow'),
    runId: input.runId === undefined || input.runId === null ? null : String(input.runId),
    jobId: input.jobId === undefined || input.jobId === null ? null : String(input.jobId),
    check: optionalText(input.check, 'check'),
    commit,
    mergeCommit: optionalText(input.mergeCommit, 'mergeCommit'),
    branch: optionalText(input.branch, 'branch'),
    observedAt: text(input.observedAt, 'observedAt'),
    failure: Object.freeze({
      name: text(input.failureName || (input.failure && input.failure.name), 'failure.name'),
      message: text(input.failureMessage || (input.failure && input.failure.message), 'failure.message'),
      exitCode: input.exitCode === undefined ? null : input.exitCode,
      evidence,
    }),
    investigation: null,
    rootCause: null,
    systemicCause: null,
    repair: null,
    verification: null,
    prevention: null,
    postmortem: null,
    learningProvenanceId: null,
    lifecycleState: 'observed',
    promotionAuthorized: false,
    recordSha256: sha256({
      repository,
      commit,
      failureCode: code.failureCode,
      evidence,
      observedAt: input.observedAt,
    }),
  });
}

function attachFailureStage(record, stage, value) {
  if (!record || typeof record !== 'object') {
    throw crucibleError('CRU-0052', 'a durable failure record is required.');
  }
  if (!LIFECYCLE.includes(stage)) {
    throw crucibleError('CRU-0052', \`Unknown failure lifecycle stage \${stage}.\`);
  }
  if (!value || typeof value !== 'object') {
    throw crucibleError('CRU-0052', \`failure lifecycle stage \${stage} requires an evidence object.\`);
  }

  const field = {
    investigating: 'investigation',
    repaired: 'repair',
    verified: 'verification',
    postmortem: 'postmortem',
    'learning-candidate': 'learningProvenanceId',
  }[stage];

  if (stage === 'learning-candidate') {
    const id = text(value.learningProvenanceId, 'learningProvenanceId');
    if (!/^LP-[a-f0-9]{16}$/.test(id)) {
      throw crucibleError('CRU-0052', 'learningProvenanceId must be a Learning Provenance ID.');
    }
    return Object.freeze({ ...record, learningProvenanceId: id, lifecycleState: stage });
  }

  if (stage === 'governed' || stage === 'vetted') {
    return Object.freeze({
      ...record,
      lifecycleState: stage,
      promotionAuthorized: value.promotionAuthorized === true && stage === 'vetted',
    });
  }

  return Object.freeze({
    ...record,
    [field]: Object.freeze({ ...value }),
    lifecycleState: stage,
    promotionAuthorized: false,
  });
}

function authorizePromotion(record, verification) {
  if (!record || typeof record !== 'object') {
    throw crucibleError('CRU-0052', 'a durable failure record is required.');
  }
  if (!verification || verification.independent !== true || verification.result !== 'passed') {
    return Object.freeze({ ...record, promotionAuthorized: false });
  }
  if (!record.rootCause || !record.repair || !record.verification) {
    return Object.freeze({ ...record, promotionAuthorized: false });
  }
  return Object.freeze({
    ...record,
    verification: Object.freeze({ ...record.verification, ...verification }),
    lifecycleState: 'governed',
    promotionAuthorized: true,
  });
}

function summarizeFailure(record) {
  return {
    failureId: record.failureId,
    failureCode: record.failureCode,
    failureCodeStatus: record.failureCodeStatus,
    repository: record.repository,
    check: record.check,
    commit: record.commit,
    lifecycleState: record.lifecycleState,
    promotionAuthorized: record.promotionAuthorized,
    hasEvidence: record.failure.evidence.length > 0,
    hasRootCause: Boolean(record.rootCause),
    hasRepair: Boolean(record.repair),
    hasVerification: Boolean(record.verification),
    hasPostmortem: Boolean(record.postmortem),
    learningProvenanceId: record.learningProvenanceId,
  };
}

module.exports = {
  SCHEMA_VERSION,
  LIFECYCLE,
  createFailureRecord,
  attachFailureStage,
  authorizePromotion,
  summarizeFailure,
  classifyFailureCode,
  normalizeFailureEvidence,
};
