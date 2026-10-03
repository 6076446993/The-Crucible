'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { makeCandidate, sha } = require('./scientificLearning');
const { describeCode } = require('./failureCodes');
const { createLearningProvenance } = require('./learningProvenance');

const KIND = 'repair-observation';
const PREVENTION_KIND = 'prevention-candidate';
const REGRESSION_MEMORY_KIND = 'repair-regression-memory';

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text.`);
  return value.trim();
}

function digest(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value || '')) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
}

function repairObservationCandidate({ projectId, repository, commitSha, operation, file, beforeSha256, afterSha256, failureCode = null, canonicalFailureId = null, observedAt = new Date().toISOString() }) {
  text(projectId, 'projectId');
  text(repository, 'repository');
  text(operation, 'operation');
  text(file, 'file');
  digest(beforeSha256, 'beforeSha256');
  digest(afterSha256, 'afterSha256');
  if (failureCode !== null && !/^CRU-\d{4}$/.test(failureCode)) throw new Error('failureCode must be null or a CRU-#### code.');
  if (failureCode && !describeCode(failureCode)) throw new Error(`failureCode ${failureCode} is not an active CRU bug/error classification.`);
  if (canonicalFailureId !== null) text(canonicalFailureId, 'canonicalFailureId');
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('observedAt must be an ISO timestamp.');

  const evidence = {
    repository,
    commitSha: commitSha || null,
    operation,
    file,
    beforeSha256,
    afterSha256,
    observedAt,
    failureCode,
    canonicalFailureId,
  };
  const evidenceSha256 = sha(evidence);
  const learningProvenance = createLearningProvenance({
    repository,
    observationId: `repair:${repository}:${commitSha || 'working-tree'}:${file}:${operation}${canonicalFailureId ? `:${canonicalFailureId}` : ''}`,
    observedAt,
    source: 'the-crucible-repair-learning',
  });
  return makeCandidate({
    id: `repair-observation-${evidenceSha256}`,
    projectId,
    claim: `The bounded Crucible repair operation "${operation}" changed "${file}" from SHA-256 ${beforeSha256} to SHA-256 ${afterSha256}.`,
    claimBoundary: `The Crucible repository ${repository}; one repair observation for ${file} at commit ${commitSha || 'working-tree'}.`,
    generalizationBoundary: 'This is repair provenance, not a generalized software claim. It must never be promoted as knowledge without a separately declared, reproducible claim.',
    kind: KIND,
    provenance: {
      sourceType: 'bounded-repair-observation',
      learningProvenanceId: learningProvenance.learningProvenanceId,
      lifecycleStage: 'repair',
      ...(failureCode ? { failureCode, failureCodeStatus: 'registered' } : {}),
      sourceId: `repair:${repository}:${commitSha || 'working-tree'}:${file}:${operation}${canonicalFailureId ? `:${canonicalFailureId}` : ''}`,
      retrievedAt: observedAt,
      author: 'the-crucible-auto-repair',
      license: 'project-private-repair-evidence',
      contentSha256: evidenceSha256,
    },
    createdAt: observedAt,
  });
}

function preventionCandidateFromRepairObservation({ repairCandidate, precursorPaths, requiredCheck, rationale, action = 'require-check', observedAt = new Date().toISOString() }) {
  if (!repairCandidate || repairCandidate.kind !== KIND) throw new Error('prevention candidates require a repair-observation source.');
  const failureCode = repairCandidate.provenance?.failureCode;
  if (!failureCode || !describeCode(failureCode)) throw new Error('prevention candidates require an active CRU bug/error classification.');
  if (!Array.isArray(precursorPaths) || !precursorPaths.length || precursorPaths.some((p) => typeof p !== 'string' || !p.trim())) throw new Error('precursorPaths must be a non-empty text array.');
  text(requiredCheck, 'requiredCheck');
  text(rationale, 'rationale');
  if (!['block', 'require-check', 'warn'].includes(action)) throw new Error('action must be block, require-check, or warn.');
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('observedAt must be an ISO timestamp.');

  const paths = [...new Set(precursorPaths.map((p) => p.trim()))].sort();
  const boundary = paths.join(',');
  const source = {
    repairCandidateId: repairCandidate.id,
    failureCode,
    paths,
    requiredCheck,
    action,
    rationale,
  };
  const sourceSha256 = sha(source);
  return makeCandidate({
    id: `prevention-candidate-${sourceSha256}`,
    projectId: repairCandidate.projectId,
    claim: `Before changes within ${boundary} proceed, the preflight must require "${requiredCheck}" to prevent recurrence of ${failureCode} within this tested boundary.`,
    claimBoundary: boundary,
    generalizationBoundary: 'This candidate applies only to the declared precursor paths and required check. It cannot become vetted prevention until controlled reproduction, causal isolation, negative/regression testing, independent verification, and governance promotion all pass.',
    kind: PREVENTION_KIND,
    provenance: {
      sourceType: 'repair-derived-prevention-candidate',
      learningProvenanceId: repairCandidate.provenance.learningProvenanceId,
      lifecycleStage: 'prevention-candidate',
      failureCode,
      failureCodeStatus: 'registered',
      sourceId: `prevention:${repairCandidate.id}`,
      retrievedAt: observedAt,
      author: 'the-crucible-repair-learning',
      license: 'project-private-repair-evidence',
      contentSha256: sourceSha256,
    },
    createdAt: observedAt,
  });
}

function queuePreventionCandidate({ learningRoot, projectId, repairCandidateId, precursorPaths, requiredCheck, rationale, action = 'require-check', now = () => new Date().toISOString() }) {
  if (!learningRoot) throw new Error('learningRoot is required.');
  const { DurableScientificLearningStore } = require('./scientificLearning');
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId });
  const repairRecord = store.get(repairCandidateId);
  if (!repairRecord) throw new Error('repair candidate does not exist in the learning store.');
  const candidate = preventionCandidateFromRepairObservation({
    repairCandidate: repairRecord.candidate,
    precursorPaths,
    requiredCheck,
    rationale,
    action,
    observedAt: now(),
  });
  const existing = store.get(candidate.id);
  if (!existing) store.ingest(candidate);
  return {
    queued: true,
    candidateId: candidate.id,
    sourceRepairCandidateId: repairCandidateId,
    failureCode: candidate.provenance.failureCode,
    state: (store.get(candidate.id) || existing).state,
    promotionAuthorized: false,
    nextRequiredStage: 'hypothesis',
    note: 'Queued prevention candidates are not vetted knowledge. They must pass the scientific-learning state machine and governance before cruPrevention can consume them.',
  };
}

function queueMappedPreventionCandidates({ learningRoot, projectId, mappings, now = () => new Date().toISOString() }) {
  if (!Array.isArray(mappings)) throw new Error('prevention mappings must be an array.');
  const { DurableScientificLearningStore } = require('./scientificLearning');
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId });
  const repairs = store.read().candidateRecords.filter((record) => record.candidate.kind === KIND && record.candidate.provenance.failureCode);
  const queued = [];
  for (const record of repairs) {
    const mapping = mappings.find((item) => item.failureCode === record.candidate.provenance.failureCode);
    if (!mapping) continue;
    queued.push(queuePreventionCandidate({
      learningRoot, projectId, repairCandidateId: record.candidate.id,
      precursorPaths: mapping.precursorPaths, requiredCheck: mapping.requiredCheck,
      rationale: mapping.rationale, action: mapping.action || 'require-check', now,
    }));
  }
  return { repairEvidenceCount: repairs.length, queuedCount: queued.length, queued, promotionAuthorized: false };
}


function repairRegressionMemoryCandidate({ projectId, repository, regressionId, repairStrategy, failureMode, evidenceSha256, observedAt = new Date().toISOString() }) {
  text(projectId, 'projectId'); text(repository, 'repository'); text(regressionId, 'regressionId');
  text(repairStrategy, 'repairStrategy'); text(failureMode, 'failureMode'); digest(evidenceSha256, 'evidenceSha256');
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('observedAt must be an ISO timestamp.');
  const source = { repository, regressionId, repairStrategy, failureMode, evidenceSha256, observedAt };
  const sourceSha256 = sha(source);
  return makeCandidate({
    id: `repair-regression-memory-${sourceSha256}`,
    projectId,
    claim: `Repair strategy "${repairStrategy}" did not work for failure mode "${failureMode}" in the evidenced circumstances recorded by repair regression "${regressionId}". Future repair planning must consult this outcome before repeating the same strategy under materially equivalent conditions.`,
    claimBoundary: `${repository}:${regressionId}:${failureMode}`,
    generalizationBoundary: 'Failure-memory learning only. This records what did not work in the evidenced circumstances so the same mistake is not repeated blindly. It does not subtract or erase other knowledge, prove the strategy can never work, endorse an alternative strategy, or generalize beyond materially equivalent conditions without new evidence.',
    kind: REGRESSION_MEMORY_KIND,
    provenance: {
      sourceType: 'repair-regression-failure-memory',
      lifecycleStage: 'repair-regression-failure-memory',
      sourceId: `repair-regression:${repository}:${regressionId}`,
      retrievedAt: observedAt,
      author: 'the-crucible-repair-learning',
      license: 'project-private-repair-evidence',
      contentSha256: sourceSha256,
    },
    createdAt: observedAt,
  });
}

function snapshotFiles(root) {
  const result = new Map();
  let files = [];
  try {
    const { execFileSync } = require('node:child_process');
    files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
  } catch {
    return result;
  }
  for (const file of files) {
    const full = path.join(root, file);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    result.set(file, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
  }
  return result;
}

function recordRepairObservations({ root, learningRoot, projectId, repository, commitSha, changed, operation = 'internal-repair', failureCode = null, canonicalFailureId = null, now = () => new Date().toISOString(), before }) {
  if (!learningRoot) return { recorded: false, reason: 'repair learning root was not configured', candidateIds: [] };
  const { DurableScientificLearningStore } = require('./scientificLearning');
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId });
  const after = snapshotFiles(root);
  const candidates = [];
  for (const file of [...new Set(changed || [])]) {
    const beforeSha256 = before?.get(file);
    const afterSha256 = after.get(file);
    if (!beforeSha256 || !afterSha256 || beforeSha256 === afterSha256) continue;
    candidates.push(repairObservationCandidate({ projectId, repository, commitSha, operation, file, beforeSha256, afterSha256, failureCode, canonicalFailureId, observedAt: now() }));
  }
  if (!candidates.length) return { recorded: false, reason: 'no changed file had a verifiable before/after content hash', candidateIds: [] };
  const records = store.ingestMany(candidates);
  return {
    recorded: true,
    reason: null,
    candidateIds: candidates.map((candidate) => candidate.id),
    newlyIngested: records.map((record) => record.candidate.id),
    learningRoot,
    revision: store.read().revision,
    promotionAuthorized: false,
    note: 'Repair observations are durable candidate evidence. They are explicitly non-promotable repair provenance until a separate governed learning claim and independent verification exist.',
  };
}

module.exports = { KIND, PREVENTION_KIND, REGRESSION_MEMORY_KIND, repairRegressionMemoryCandidate, repairObservationCandidate, preventionCandidateFromRepairObservation, queuePreventionCandidate, queueMappedPreventionCandidates, snapshotFiles, recordRepairObservations };
