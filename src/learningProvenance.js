'use strict';

const crypto = require('node:crypto');

const PROVENANCE_SCHEMA_VERSION = 1;
const STAGES = Object.freeze([
  'observation',
  'investigation',
  'repair',
  'verification',
  'postmortem',
  'learning-candidate',
  'governance',
  'vetted-learning',
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])])
  );
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(canonical(value)))
    .digest('hex');
}

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} must be non-empty text.`);
  }
  return value.trim();
}

function requireArray(value, name) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${name} must contain at least one item.`);
  }
  return value;
}

function createLearningProvenance({
  repository,
  pullRequest = null,
  failureCode = null,
  observationId,
  observedAt = new Date().toISOString(),
  source = 'the-crucible',
}) {
  requireText(repository, 'repository');
  requireText(observationId, 'observationId');
  if (!Number.isFinite(Date.parse(observedAt))) throw new TypeError('observedAt must be an ISO timestamp.');
  const identity = { repository, pullRequest: pullRequest == null ? null : Number(pullRequest), failureCode: failureCode || null, observationId, observedAt, source };
  return {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    learningProvenanceId: `LP-${sha256(identity).slice(0, 16)}`,
    repository,
    pullRequest: identity.pullRequest,
    failureCode: identity.failureCode,
    observationId,
    observedAt,
    source,
    lifecycle: STAGES.map((stage, index) => ({ stage, state: index === 0 ? 'recorded' : 'not-yet-eligible' })),
    chain: [],
  };
}

function appendProvenanceStage(provenance, {
  stage,
  recordId,
  status = 'recorded',
  evidence = [],
  recordedAt = new Date().toISOString(),
}) {
  if (!provenance || provenance.schemaVersion !== PROVENANCE_SCHEMA_VERSION) throw new TypeError('Invalid learning provenance.');
  if (!STAGES.includes(stage)) throw new TypeError(`Unknown provenance stage: ${stage}`);
  requireText(recordId, 'recordId');
  if (!Array.isArray(evidence)) throw new TypeError('evidence must be an array.');
  const next = JSON.parse(JSON.stringify(provenance));
  next.chain.push({ stage, recordId, status, evidence, recordedAt });
  next.lifecycle = next.lifecycle.map((entry) =>
    entry.stage === stage ? { ...entry, state: status } : entry
  );
  return next;
}

function createPostmortem({
  learningProvenanceId,
  postmortemId,
  symptom,
  rootCause,
  systemicCause,
  correctiveActions,
  preventiveActions,
  verificationEvidence,
  lessonsLearned,
  relatedProvenanceIds = [],
  createdAt = new Date().toISOString(),
}) {
  requireText(learningProvenanceId, 'learningProvenanceId');
  requireText(postmortemId, 'postmortemId');
  requireText(symptom, 'symptom');
  requireText(rootCause, 'rootCause');
  requireText(systemicCause, 'systemicCause');
  requireArray(correctiveActions, 'correctiveActions');
  requireArray(preventiveActions, 'preventiveActions');
  requireArray(verificationEvidence, 'verificationEvidence');
  requireArray(lessonsLearned, 'lessonsLearned');
  if (!Number.isFinite(Date.parse(createdAt))) throw new TypeError('createdAt must be an ISO timestamp.');
  return {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    postmortemId,
    learningProvenanceId,
    symptom,
    rootCause,
    systemicCause,
    correctiveActions,
    preventiveActions,
    verificationEvidence,
    lessonsLearned,
    relatedProvenanceIds,
    createdAt,
    promotionEligible: verificationEvidence.length > 0,
  };
}

function significantFailureRequiresPostmortem({ severity, category } = {}) {
  return ['critical', 'high', 'security', 'learning-integrity', 'governance'].includes(String(severity || '').toLowerCase())
    || ['security', 'learning-integrity', 'governance'].includes(String(category || '').toLowerCase());
}

module.exports = {
  PROVENANCE_SCHEMA_VERSION,
  STAGES,
  sha256,
  createLearningProvenance,
  appendProvenanceStage,
  createPostmortem,
  significantFailureRequiresPostmortem,
};
