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
