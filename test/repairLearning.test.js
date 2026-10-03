const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { snapshotFiles, recordRepairObservations } = require('../src/repairLearning');
const { DurableScientificLearningStore } = require('../src/scientificLearning');

test('records real before/after repair changes as durable non-promotable learning evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-repair-learning-'));
  const learningRoot = path.join(root, 'learning');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  const file = path.join(root, 'repair-target.txt');
  fs.writeFileSync(file, 'before\n');
  const { execFileSync } = require('node:child_process');
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['add', 'repair-target.txt'], { cwd: root, stdio: 'ignore' });
  const before = snapshotFiles(root);
  fs.writeFileSync(file, 'after\n');

  const result = recordRepairObservations({
    root,
    learningRoot,
    projectId: 'the-crucible',
    repository: 'jonathanblunt1214-lgtm/The-Crucible',
    commitSha: 'working-tree',
    changed: ['repair-target.txt'],
    before,
    now: () => '2026-09-28T00:00:00.000Z',
  });

  assert.equal(result.recorded, true);
  assert.equal(result.candidateIds.length, 1);
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: 'the-crucible' });
  const record = store.get(result.candidateIds[0]);
  assert.equal(record.state, 'candidate');
  assert.equal(record.candidate.kind, 'repair-observation');
  assert.equal(record.candidate.classification, 'Insufficient Evidence');
  assert.match(record.candidate.claim, /repair operation/);
  assert.equal(record.candidate.provenance.sourceType, 'bounded-repair-observation');
  assert.match(record.candidate.provenance.learningProvenanceId, /^LP-[a-f0-9]{16}$/);
  assert.equal(record.candidate.provenance.lifecycleStage, 'repair');
});

test('does not invent learning evidence when a changed path has no verifiable before/after content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-repair-learning-empty-'));
  const learningRoot = path.join(root, 'learning');
  const result = recordRepairObservations({
    root,
    learningRoot,
    projectId: 'the-crucible',
    repository: 'jonathanblunt1214-lgtm/The-Crucible',
    commitSha: 'working-tree',
    changed: ['missing.txt'],
    before: new Map(),
  });
  assert.equal(result.recorded, false);
  assert.deepEqual(result.candidateIds, []);
});

test('repair observations carry their active CRU classification into learning provenance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-repair-learning-cru-'));
  const learningRoot = path.join(root, 'learning');
  const file = path.join(root, 'repair-target.txt');
  const { execFileSync } = require('node:child_process');
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  fs.writeFileSync(file, 'before\n');
  execFileSync('git', ['add', 'repair-target.txt'], { cwd: root, stdio: 'ignore' });
  const before = snapshotFiles(root);
  fs.writeFileSync(file, 'after\n');

  const result = recordRepairObservations({
    root, learningRoot, projectId: 'the-crucible',
    repository: 'jonathanblunt1214-lgtm/The-Crucible', commitSha: 'working-tree',
    changed: ['repair-target.txt'], before, failureCode: 'CRU-0008',
    canonicalFailureId: 'CF-workflow-config', now: () => '2026-09-29T00:00:00.000Z',
  });
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: 'the-crucible' });
  const record = store.get(result.candidateIds[0]);
  assert.equal(record.candidate.provenance.failureCode, 'CRU-0008');
  assert.equal(record.candidate.provenance.failureCodeStatus, 'registered');
});

test('repair observations refuse retired CRU process codes', () => {
  assert.throws(() => require('../src/repairLearning').repairObservationCandidate({
    projectId: 'the-crucible', repository: 'owner/repo', operation: 'repair', file: 'a.js',
    beforeSha256: 'a'.repeat(64), afterSha256: 'b'.repeat(64), failureCode: 'CRU-0052',
  }), /not an active CRU/);
});


test('queues CRU-linked repair evidence as a separate non-vetted prevention candidate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-prevention-queue-'));
  const learningRoot = path.join(root, 'learning');
  const { repairObservationCandidate, queuePreventionCandidate } = require('../src/repairLearning');
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: 'the-crucible' });
  const repair = repairObservationCandidate({
    projectId: 'the-crucible', repository: 'owner/repo', commitSha: 'abc123',
    operation: 'workflow-repair', file: '.github/workflows/release.yml',
    beforeSha256: 'a'.repeat(64), afterSha256: 'b'.repeat(64),
    failureCode: 'CRU-0008', canonicalFailureId: 'CF-workflow-config',
    observedAt: '2026-09-29T16:00:00.000Z',
  });
  store.ingest(repair);

  const queued = queuePreventionCandidate({
    learningRoot, projectId: 'the-crucible', repairCandidateId: repair.id,
    precursorPaths: ['.github/workflows/'], requiredCheck: 'workflow-lint',
    rationale: 'The verified repair corrected a workflow defect that preflight lint can detect.',
    now: () => '2026-09-29T16:01:00.000Z',
  });

  assert.equal(queued.queued, true);
  assert.equal(queued.failureCode, 'CRU-0008');
  assert.equal(queued.state, 'candidate');
  assert.equal(queued.promotionAuthorized, false);
  assert.equal(queued.nextRequiredStage, 'hypothesis');
  const candidate = store.get(queued.candidateId);
  assert.equal(candidate.candidate.kind, 'prevention-candidate');
  assert.equal(candidate.candidate.provenance.sourceType, 'repair-derived-prevention-candidate');
  assert.equal(candidate.candidate.provenance.failureCode, 'CRU-0008');
  assert.match(candidate.candidate.claim, /workflow-lint/);
});

test('operational repair evidence cannot be converted into a CRU prevention candidate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-prevention-no-cru-'));
  const learningRoot = path.join(root, 'learning');
  const { repairObservationCandidate, queuePreventionCandidate } = require('../src/repairLearning');
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: 'the-crucible' });
  const repair = repairObservationCandidate({
    projectId: 'the-crucible', repository: 'owner/repo', operation: 'governance-cleanup', file: 'DEVLOG.md',
    beforeSha256: 'c'.repeat(64), afterSha256: 'd'.repeat(64), observedAt: '2026-09-29T16:02:00.000Z',
  });
  store.ingest(repair);
  assert.throws(() => queuePreventionCandidate({
    learningRoot, projectId: 'the-crucible', repairCandidateId: repair.id,
    precursorPaths: ['DEVLOG.md'], requiredCheck: 'audit:handoff', rationale: 'operational evidence',
  }), /active CRU bug\/error classification/);
});

test('repair regression memory records what failed without subtracting knowledge or proving an alternative', () => {
  const { repairRegressionMemoryCandidate, REGRESSION_MEMORY_KIND } = require('../src/repairLearning');
  const candidate = repairRegressionMemoryCandidate({
    projectId: 'the-crucible',
    repository: 'owner/repo',
    regressionId: 'RR-42',
    repairStrategy: 'rewrite-workflow',
    failureMode: 'required-check-never-ran',
    evidenceSha256: 'e'.repeat(64),
    observedAt: '2026-10-03T15:29:00.000Z',
  });
  assert.equal(candidate.kind, REGRESSION_MEMORY_KIND);
  assert.equal(candidate.classification, 'Insufficient Evidence');
  assert.equal(candidate.provenance.sourceType, 'repair-regression-failure-memory');
  assert.equal(candidate.provenance.lifecycleStage, 'repair-regression-failure-memory');
  assert.match(candidate.claim, /did not work/);
  assert.match(candidate.generalizationBoundary, /does not subtract or erase other knowledge/);
  assert.match(candidate.generalizationBoundary, /does not.*endorse an alternative strategy/i);
});
