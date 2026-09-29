const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createFailureRecord,
  attachFailureStage,
  authorizePromotion,
  summarizeFailure,
} = require('../src/failureRecord');

const BASE = {
  repository: 'owner/repo',
  project: 'nexus',
  workflow: 'Self-Test',
  runId: 123,
  jobId: 456,
  check: 'current suite classification is stable',
  commit: 'a'.repeat(40),
  mergeCommit: 'b'.repeat(40),
  branch: 'repair-learning',
  observedAt: '2026-09-28T12:00:00.000Z',
  failureCode: 'CRU-0050',
  failureName: 'AssertionError',
  failureMessage: 'actual and expected classifications differ',
  exitCode: 1,
  evidence: [
    {
      kind: 'log',
      value: 'Expected values to be strictly deep-equal',
      source: 'github-actions://run/123/job/456',
    },
    {
      kind: 'actual',
      value: 'test/repairLearning.test.js',
    },
    {
      kind: 'expected',
      value: 'canonical governed classification',
    },
  ],
};

test('failure records preserve enough CI identity and evidence to diagnose the event later', () => {
  const record = createFailureRecord(BASE);
  assert.match(record.failureId, /^FR-[a-f0-9]{16}$/);
  assert.equal(record.failureCodeStatus, 'registered');
  assert.equal(record.repository, BASE.repository);
  assert.equal(record.runId, '123');
  assert.equal(record.jobId, '456');
  assert.equal(record.commit, BASE.commit);
  assert.equal(record.mergeCommit, BASE.mergeCommit);
  assert.equal(record.failure.evidence.length, 3);
  assert.equal(record.lifecycleState, 'observed');
  assert.equal(record.promotionAuthorized, false);
  assert.equal(record.rootCause, null);
  assert.equal(record.repair, null);
  assert.equal(record.verification, null);
});

test('an unknown CRU code is retained as pending registration rather than discarded', () => {
  const record = createFailureRecord({
    ...BASE,
    failureCode: 'CRU-9999',
  });
  assert.equal(record.failureCode, 'CRU-9999');
  assert.equal(record.failureCodeStatus, 'pending-registration');
});

test('an uncoded failure is explicitly represented as a diagnosis-coverage gap', () => {
  const record = createFailureRecord({
    ...BASE,
    failureCode: undefined,
  });
  assert.equal(record.failureCode, 'CRU-0000');
  assert.equal(record.failureCodeStatus, 'uncoded');
});

test('root cause and repair do not authorize promotion by themselves', () => {
  let record = createFailureRecord(BASE);
  record = attachFailureStage(record, 'investigating', {
    finding: 'classification fixture and canonical registry disagree',
  });
  record = attachFailureStage(record, 'repaired', {
    commit: 'c'.repeat(40),
    changedPaths: ['test/_testCadenceCore.js'],
  });
  assert.equal(record.promotionAuthorized, false);
  assert.equal(record.lifecycleState, 'repaired');

  record = attachFailureStage(record, 'verified', {
    independent: true,
    result: 'passed',
    verifierId: 'ci-self-test',
  });
  assert.equal(record.promotionAuthorized, false);
});

test('promotion is authorized only after independent verification plus root cause, repair, and verification evidence', () => {
  let record = createFailureRecord(BASE);
  record = attachFailureStage(record, 'investigating', {
    rootCause: 'the certification fixture did not match the governed classification source',
  });
  record = Object.freeze({
    ...record,
    rootCause: {
      statement: 'the certification fixture did not match the governed classification source',
      evidence: ['actual-vs-expected'],
    },
  });
  record = attachFailureStage(record, 'repaired', {
    commit: 'c'.repeat(40),
    changedPaths: ['test/_testCadenceCore.js'],
  });
  record = attachFailureStage(record, 'verified', {
    independent: true,
    result: 'passed',
    verifierId: 'ci-self-test',
  });

  const gated = authorizePromotion(record, {
    independent: true,
    result: 'passed',
    verifierId: 'independent-verifier',
  });
  assert.equal(gated.promotionAuthorized, true);
  assert.equal(gated.lifecycleState, 'governed');
});

test('a failed or non-independent verification can never authorize promotion', () => {
  let record = createFailureRecord(BASE);
  record = Object.freeze({
    ...record,
    rootCause: { statement: 'fixture drift' },
    repair: { commit: 'c'.repeat(40) },
    verification: { independent: false, result: 'passed' },
  });

  assert.equal(authorizePromotion(record, { independent: false, result: 'passed' }).promotionAuthorized, false);
  assert.equal(authorizePromotion(record, { independent: true, result: 'failed' }).promotionAuthorized, false);
});

test('summary exposes the evidence state without pretending the failure is understood', () => {
  const summary = summarizeFailure(createFailureRecord(BASE));
  assert.equal(summary.failureCode, 'CRU-0050');
  assert.equal(summary.hasEvidence, true);
  assert.equal(summary.hasRootCause, false);
  assert.equal(summary.hasRepair, false);
  assert.equal(summary.hasVerification, false);
  assert.equal(summary.promotionAuthorized, false);
});
