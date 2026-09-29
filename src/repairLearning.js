'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { makeCandidate, sha } = require('./scientificLearning');
const { describeCode } = require('./failureCodes');
const { createLearningProvenance } = require('./learningProvenance');

const KIND = 'repair-observation';

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

module.exports = { KIND, repairObservationCandidate, snapshotFiles, recordRepairObservations };
