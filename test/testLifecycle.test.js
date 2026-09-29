const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateEntry, executableTests } = require('../src/testLifecycle');

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
