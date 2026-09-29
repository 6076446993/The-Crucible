const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateEntry, executableTests, marginalUtilityAssessment, proposeTestDisposition, reactivateFromEvidence, testEvolutionCandidate, transitionFromVerifiedEvolution } = require('../src/testLifecycle');

test('obsolete and superseded tests leave routine execution but remain available historically', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-test-lifecycle-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const registryFile = path.join(root, 'lifecycle.json');
  fs.writeFileSync(registryFile, JSON.stringify({ schemaVersion:1, tests:[
    { test:'test/old.test.js', state:'obsolete', hypothesisId:'H1', successorHypothesisId:'H2', evidence:['verified H2 supersession'], reason:'H2 replaced the bounded behavior', reviewedAt:'2026-09-29T17:20:00.000Z' },
    { test:'test/challenged.test.js', state:'challenged', hypothesisId:'H3', successorHypothesisId:'H4', evidence:['new contradictory outcome'], reason:'replacement under verification', reviewedAt:'2026-09-29T17:21:00.000Z' }
  ]}));
  const routine = executableTests(['test/active.test.js','test/old.test.js','test/challenged.test.js'], { registryFile });
  assert.deepEqual(routine.selected, ['test/active.test.js','test/challenged.test.js']);
  assert.equal(routine.skipped[0].test, 'test/old.test.js');
  assert.equal(routine.challenged[0].test, 'test/challenged.test.js');
  const historical = executableTests(['test/old.test.js'], { registryFile, includeHistorical:true });
  assert.deepEqual(historical.selected, ['test/old.test.js']);
});

test('age alone cannot obsolete a test and obsolescence requires evidence or a successor', () => {
  assert.throws(() => validateEntry({ test:'test/old.test.js', state:'obsolete', hypothesisId:'H1', reason:'two years old', reviewedAt:'2026-09-29T17:20:00.000Z' }), /successor hypothesis or explicit evidence/);
  const active = validateEntry({ test:'test/ancient.test.js', state:'active', hypothesisId:'H-live', evidence:[], reason:'still protects active behavior', reviewedAt:'2026-09-29T17:20:00.000Z' });
  assert.equal(active.state, 'active');
});


test('test evolution proposes measurable improvement without retiring the current test', () => {
  const candidate = testEvolutionCandidate({
    projectId:'the-crucible', test:'test/workflow.test.js', hypothesisId:'H1', successorHypothesisId:'H2',
    currentCoverage:0.92, proposedCoverage:0.92, currentCost:120, proposedCost:45,
    evidenceOutcomeIds:['run-1','run-2'], claimBoundary:'workflow validation behavior',
    observedAt:'2026-09-29T17:30:00.000Z',
  });
  assert.equal(candidate.kind, 'test-evolution-candidate');
  assert.throws(() => testEvolutionCandidate({
    projectId:'the-crucible', test:'test/workflow.test.js', hypothesisId:'H1', successorHypothesisId:'H2',
    currentCoverage:0.92, proposedCoverage:0.80, currentCost:120, proposedCost:20,
    evidenceOutcomeIds:['run-1','run-2'], claimBoundary:'workflow validation behavior',
  }), /cannot reduce measured coverage/);
});

test('only scientifically verified test evolution can supersede the current test', () => {
  const current = { test:'test/workflow.test.js', state:'challenged', hypothesisId:'H1', successorHypothesisId:'H2', evidence:['outcome drift'], reason:'workflow validation behavior', reviewedAt:'2026-09-29T17:30:00.000Z' };
  const candidate = testEvolutionCandidate({
    projectId:'the-crucible', test:current.test, hypothesisId:'H1', successorHypothesisId:'H2',
    currentCoverage:0.92, proposedCoverage:0.96, currentCost:120, proposedCost:80,
    evidenceOutcomeIds:['run-1','run-2'], claimBoundary:'workflow validation behavior',
    observedAt:'2026-09-29T17:31:00.000Z',
  });
  assert.throws(() => transitionFromVerifiedEvolution({ current, verifiedRecord:{ state:'candidate', candidate } }), /scientifically verified/);
  const verified = { state:'verified', candidate, proof:{ experimentBoundary:candidate.claimBoundary } };
  const evolved = transitionFromVerifiedEvolution({ current, verifiedRecord:verified, reviewedAt:'2026-09-29T17:32:00.000Z' });
  assert.equal(evolved.state, 'superseded');
  assert.match(evolved.evidence.at(-1), /^verified:/);
});


test('size and age cannot archive a test that still has unique protection', () => {
  const entry = { test:'test/legacy-platform.test.js', state:'active', hypothesisId:'H-legacy', evidence:[], reason:'protects legacy platform', reviewedAt:'2026-09-29T18:00:00.000Z' };
  const assessment = marginalUtilityAssessment({ test:entry.test, uniquePlatforms:1, overlapRatio:0.99, executionMs:600000, storageBytes:1073741824 });
  const proposal = proposeTestDisposition({ entry, assessment, preservedCoverage:true, reason:'suite pressure review' });
  assert.equal(proposal.proposedState, 'active');
  assert.match(proposal.reason, /Unique protection/);
});

test('fully redundant coverage can be archived and new relevant evidence reactivates it', () => {
  const entry = { test:'test/duplicate.test.js', state:'active', hypothesisId:'H-old', evidence:[], reason:'original protection', reviewedAt:'2026-09-29T18:00:00.000Z' };
  const assessment = marginalUtilityAssessment({ test:entry.test, overlapRatio:1, executionMs:30000, storageBytes:100000000 });
  const proposal = proposeTestDisposition({ entry, assessment, preservedCoverage:true, reason:'verified duplicate coverage', reviewedAt:'2026-09-29T18:01:00.000Z' });
  assert.equal(proposal.proposedState, 'archived');
  const archived = validateEntry({ ...entry, state:'archived', evidence:['verified duplicate coverage'], reason:proposal.reason, reviewedAt:proposal.reviewedAt });
  const revived = reactivateFromEvidence({ entry:archived, evidence:'CRU-0008 precursor matched archived boundary', reason:'new failure evidence challenges archival', reviewedAt:'2026-09-29T18:02:00.000Z' });
  assert.equal(revived.state, 'challenged');
  assert.match(revived.evidence.at(-1), /CRU-0008/);
});

test('partial redundancy reduces cadence instead of archiving', () => {
  const entry = { test:'test/overlap.test.js', state:'active', hypothesisId:'H-overlap', evidence:[], reason:'overlapping protection', reviewedAt:'2026-09-29T18:00:00.000Z' };
  const assessment = marginalUtilityAssessment({ test:entry.test, overlapRatio:0.8, executionMs:45000, storageBytes:50000000 });
  const proposal = proposeTestDisposition({ entry, assessment, preservedCoverage:true, reason:'high overlap with active suite' });
  assert.equal(proposal.proposedState, 'reduced-cadence');
});
