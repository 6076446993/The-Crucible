'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STATES = Object.freeze(['active', 'challenged', 'superseded', 'obsolete']);
const EVOLUTION_KIND = 'test-evolution-candidate';
const { makeCandidate, sha } = require('./scientificLearning');

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text.`);
  return value.trim();
}
function iso(value, label) {
  text(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp.`);
}

function validateEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('test lifecycle entry must be an object.');
  const state = text(value.state, 'state');
  if (!STATES.includes(state)) throw new Error(`test lifecycle state must be one of: ${STATES.join(', ')}.`);
  const entry = {
    test: text(value.test, 'test'),
    state,
    hypothesisId: text(value.hypothesisId, 'hypothesisId'),
    successorHypothesisId: value.successorHypothesisId ? text(value.successorHypothesisId, 'successorHypothesisId') : null,
    evidence: Array.isArray(value.evidence) ? value.evidence.map((item) => text(item, 'evidence item')) : [],
    reason: text(value.reason, 'reason'),
    reviewedAt: value.reviewedAt,
  };
  iso(entry.reviewedAt, 'reviewedAt');
  if ((state === 'superseded' || state === 'obsolete') && !entry.successorHypothesisId && !entry.evidence.length) throw new Error('superseded/obsolete tests require a successor hypothesis or explicit evidence.');
  return Object.freeze(entry);
}

function readTestLifecycle(file) {
  if (!file || !fs.existsSync(file)) return { schemaVersion:1, tests:[] };
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.schemaVersion !== 1 || !Array.isArray(value.tests)) throw new Error('test lifecycle registry is invalid.');
  return { schemaVersion:1, tests:value.tests.map(validateEntry) };
}

function executableTests(tests, { registryFile = path.join('governingDocuments', 'test-lifecycle.json'), includeHistorical = false } = {}) {
  const registry = readTestLifecycle(registryFile);
  const byTest = new Map(registry.tests.map((entry) => [entry.test, entry]));
  const selected = [], skipped = [], challenged = [];
  for (const test of tests) {
    const lifecycle = byTest.get(test);
    if (!lifecycle || lifecycle.state === 'active') selected.push(test);
    else if (lifecycle.state === 'challenged') { selected.push(test); challenged.push(lifecycle); }
    else if (includeHistorical) selected.push(test);
    else skipped.push(lifecycle);
  }
  return { selected, skipped, challenged };
}

function testEvolutionCandidate({ projectId, test, hypothesisId, successorHypothesisId, currentCoverage, proposedCoverage, currentCost, proposedCost, evidenceOutcomeIds, claimBoundary, observedAt = new Date().toISOString() }) {
  text(projectId, 'projectId'); text(test, 'test'); text(hypothesisId, 'hypothesisId'); text(successorHypothesisId, 'successorHypothesisId'); text(claimBoundary, 'claimBoundary'); iso(observedAt, 'observedAt');
  for (const [label, value] of Object.entries({ currentCoverage, proposedCoverage, currentCost, proposedCost })) if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number.`);
  if (!Array.isArray(evidenceOutcomeIds) || evidenceOutcomeIds.length < 2) throw new Error('test evolution requires at least two outcome evidence ids.');
  if (proposedCoverage < currentCoverage) throw new Error('test evolution cannot reduce measured coverage within the declared boundary.');
  if (proposedCoverage === currentCoverage && proposedCost >= currentCost) throw new Error('test evolution must improve coverage or reduce execution cost without reducing coverage.');
  const evidence = { test, hypothesisId, successorHypothesisId, currentCoverage, proposedCoverage, currentCost, proposedCost, evidenceOutcomeIds:[...new Set(evidenceOutcomeIds)].sort(), claimBoundary };
  return makeCandidate({
    id: `test-evolution-candidate-${sha(evidence)}`, projectId,
    claim: `Within ${claimBoundary}, successor ${successorHypothesisId} preserves or improves measured coverage (${currentCoverage} -> ${proposedCoverage}) while test execution cost changes from ${currentCost} to ${proposedCost}.`,
    claimBoundary,
    generalizationBoundary: 'A test may be superseded only after the successor is scientifically verified within this exact boundary. Failed or incomplete replacement proof leaves the existing test active.',
    kind: EVOLUTION_KIND,
    provenance: {
      sourceType:'adaptive-test-outcome-analysis', sourceId:`test-evolution:${sha(evidence)}`, retrievedAt:observedAt,
      author:'the-crucible-adaptive-testing', license:'project-private-test-evidence', contentSha256:sha(evidence), lifecycleStage:'test-evolution-candidate',
    },
    createdAt:observedAt,
  });
}

function transitionFromVerifiedEvolution({ current, verifiedRecord, reviewedAt = new Date().toISOString() }) {
  const entry = validateEntry(current);
  if (!verifiedRecord || verifiedRecord.state !== 'verified' || verifiedRecord.candidate?.kind !== EVOLUTION_KIND) throw new Error('test lifecycle evolution requires a scientifically verified test-evolution candidate.');
  if (verifiedRecord.proof?.experimentBoundary !== verifiedRecord.candidate.claimBoundary) throw new Error('verified test evolution proof exceeds its declared boundary.');
  return validateEntry({
    ...entry, state:'superseded', successorHypothesisId:verifiedRecord.candidate.id,
    evidence:[...entry.evidence, `verified:${verifiedRecord.candidate.id}`],
    reason:`Scientifically verified successor: ${verifiedRecord.candidate.claim}`, reviewedAt,
  });
}

module.exports = { STATES, EVOLUTION_KIND, validateEntry, readTestLifecycle, executableTests, testEvolutionCandidate, transitionFromVerifiedEvolution };

