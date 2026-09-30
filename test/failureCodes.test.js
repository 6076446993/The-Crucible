'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  UNCODED, FAILURE_CODES, crucibleError, failureCode, describeCode, codesInText,
  operationalCodeFor, operationalError, operationalCode, describeOperationalCode, operationalCodesInText,
  remedyFor, testRequestFor, repairableByImmuneSystem, coverageReport, auditFailureCodes,
} = require('../src/failureCodes');
const { selectRequestedTests } = require('../src/testingOrgan');

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-failure-codes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

// The owner's rule has no exceptions in it: "every error and failure must have a diagnosable
// error code". A registry entry that names a failure but says nothing about the fix is the same
// guessing one layer up, so the fix is part of what a code is, not an optional extra.
test('every code carries a meaning and a remedy the immune system can act on', () => {
  const kinds = new Set(['automatic', 'guided', 'owner-decision']);
  for (const [code, entry] of Object.entries(FAILURE_CODES)) {
    const publicCode = code === UNCODED ? UNCODED : (operationalCodeFor(code) || code);
    assert.equal(entry.code, publicCode, `${code} must expose the correct public code`);
    assert.ok(entry.category, `${code} needs a category`);
    assert.ok(entry.meaning && entry.meaning.length > 20, `${code} needs a meaning a reader can act on`);
    assert.ok(entry.next && entry.next.length > 20, `${code} needs a next action`);
    const remedy = remedyFor(publicCode);
    assert.ok(remedy, `${code} needs a remedy`);
    assert.ok(kinds.has(remedy.kind), `${code} remedy kind must be one of ${[...kinds].join(', ')}`);
    assert.ok(remedy.forbidden && /never/i.test(remedy.forbidden), `${code} must name the fix that would only hide the symptom`);
    assert.ok(remedy.verifyWith, `${code} must say which existing tests prove a repair`);
  }
});

// The join between a code and the testing organ. A remedy that named a test which does not exist
// would fail only at the moment the immune system tried to use it, which is the worst time to
// find out; the testing organ refuses unknown tests by name, so running every remedy through it
// here is the same check the bus would apply.
test('every remedy names a test selection the testing organ will actually accept', () => {
  for (const code of Object.keys(FAILURE_CODES)) {
    const publicCode = code === UNCODED ? UNCODED : (operationalCodeFor(code) || code);
    const selection = selectRequestedTests(testRequestFor(publicCode));
    assert.ok(selection.tests.length > 0, `${code} must select at least one existing test`);
  }
});

// The distinction the repair selection policy rests on: some failures have a correct mechanical
// fix and some are somebody's decision. A code that blurred the two would let an automaton make
// a call that was never its to make.
test('a code says whether the immune system may repair it unaided', () => {
  assert.equal(repairableByImmuneSystem('OPS-0012'), true, 'a stale README regenerates mechanically');
  assert.equal(repairableByImmuneSystem('OPS-0009'), false, 'disabling the Security Gate is never the immune system\'s call');
  assert.equal(repairableByImmuneSystem('OPS-0015'), false, 'a collision with another pull request needs coordination, not a push');
  assert.equal(repairableByImmuneSystem(UNCODED), false, 'an uncoded failure is a gap to close, not a repair to attempt');
  assert.equal(repairableByImmuneSystem('CRU-9999'), false, 'an unknown code authorizes nothing');
});

// A code has to survive the trip it actually makes. `runner.js` captures a child process's
// stdout and stderr as a string and CI keeps only the log, so a code carried solely as a
// property would be lost exactly when it is needed.
test('a code survives being reduced to log text', () => {
  const error = operationalError('OPS-0014', 'Clutter detected:\n- stray: build/output.tmp');
  assert.equal(failureCode(error), null, 'operational conditions never become CRU classifications');
  assert.equal(operationalCode(error), 'OPS-0014');
  assert.match(error.message, /^\[OPS-0014\] /);

  const throughAPipe = new Error(`Engine tests failed with exit code 1.\n${error.message}`);
  assert.equal(operationalCode(throughAPipe), 'OPS-0014', 'the operational code is recoverable from text');

  assert.deepEqual(operationalCodesInText('[OPS-0014] a\n[OPS-0012] b\n[OPS-0014] c'), ['OPS-0014', 'OPS-0012']);
  assert.deepEqual(codesInText('[CRU-9999] not in the registry'), [], 'an unregistered code is not a diagnosis');
});

// Throwing a code nobody wrote down would put an unlookupable string in a log, which is the
// problem this module exists to remove.
test('an unregistered code cannot be thrown', () => {
  assert.throws(() => crucibleError('CRU-9999', 'invented'), /Unknown failure code CRU-9999/);
  assert.equal(describeCode('CRU-9999'), null);
  assert.equal(failureCode(null), null);
  assert.equal(failureCode(new Error('no code here')), null);
});

// Six hundred throw sites will not grow codes in one commit, and a check that pretended
// otherwise would be turned off within a day. The ratchet is the honest version: it says exactly
// how many are uncoded, forbids more, and records every reduction.
test('the coverage ratchet lets the diagnosable surface grow and never shrink', (t) => {
  const root = workspace(t);
  const baselineFile = path.join(root, 'baseline.json');
  const sourceDir = path.join(root, 'src');
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir, 'a.js'), 'throw crucibleError("CRU-0012", "one");\nthrow crucibleError("CRU-0014", "two");\n');
  fs.writeFileSync(path.join(sourceDir, 'b.js'), 'throw crucibleError("CRU-0002", "coded");\n');

  const measured = coverageReport(sourceDir);
  assert.equal(measured.uncoded, 2);
  assert.equal(measured.coded, 1);

  fs.writeFileSync(baselineFile, JSON.stringify({ uncodedThrowSites: 2, byFile: { 'a.js': 2 } }));
  assert.equal(auditFailureCodes({ root: sourceDir, baselineFile }).ok, true);

  fs.appendFileSync(path.join(sourceDir, 'a.js'), 'throw crucibleError("CRU-0015", "three");\n');
  const grown = auditFailureCodes({ root: sourceDir, baselineFile });
  assert.equal(grown.ok, false);
  assert.equal(grown.code, 'OPS-0022');
  assert.match(grown.reason, /rose from 2 to 3/);
  assert.match(grown.reason, /a\.js 2 -> 3/);

  fs.writeFileSync(path.join(sourceDir, 'a.js'), 'throw crucibleError("CRU-0002", "now coded");\n');
  const tightened = auditFailureCodes({ root: sourceDir, baselineFile });
  assert.equal(tightened.ok, true);
  assert.equal(tightened.tightened, true);
  assert.match(tightened.reason, /fell from 2 to 0/);
});

// Without a baseline the ratchet has nothing to ratchet against, and silently passing would let
// coverage drift back with no record.
test('coverage cannot be ratcheted without a recorded baseline', (t) => {
  const root = workspace(t);
  fs.mkdirSync(path.join(root, 'src'));
  const result = auditFailureCodes({ root: path.join(root, 'src'), baselineFile: path.join(root, 'missing.json') });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'OPS-0022');
});

// This repository's own state, checked against its own recorded baseline rather than a fixture.
test('this repository satisfies its own failure-code baseline', () => {
  const result = auditFailureCodes();
  assert.equal(result.ok, true, result.reason);
});

// The link the owner asked for, end to end: a diagnosis has to arrive at the immune system as
// something it can act on. This asserts the shape of what crosses that link rather than the
// wiring, because the wiring is already refused at startup by `assertFlyByWire` and the thing
// that could still silently rot is the payload.
test('a diagnosis reaches the immune system carrying the remedy and the tests that prove it', () => {
  const { GOVERNED_ORGANS } = require('../src/circulationLinkage');
  assert.ok(GOVERNED_ORGANS.includes('diagnostics'), 'the diagnostic organ is on the bus, not beside it');

  // A code the immune system may act on hands over a command and a runnable test selection.
  const repairable = remedyFor('OPS-0012');
  assert.equal(repairable.kind, 'automatic');
  assert.equal(repairable.command, 'npm run docs:sync');
  assert.deepEqual(testRequestFor('OPS-0012'), { tests: ['test/docSync.test.js'] });
  assert.equal(selectRequestedTests(testRequestFor('OPS-0012')).tests.length, 1);

  // A code that is somebody's judgement is escalated rather than attempted, and says why.
  assert.equal(remedyFor('OPS-0015').kind, 'owner-decision');
  assert.equal(repairableByImmuneSystem('OPS-0015'), false);
  assert.match(remedyFor('OPS-0015').forbidden, /Never close or exclude the other pull request/);
});

// The repository's most frequently red check. Its four stop branches demand opposite responses -
// run digestion, ingest different sources, declare a scope, reconcile the declarations - and
// until each carried its own code a reader had to work out which from a paragraph of prose. This
// pins that the branch and the code stay together; deriving the code by matching the reason text
// would reintroduce exactly the pattern-matching the registry replaced.
test('each hosted-proof stop carries a code that says which blockage it is', () => {
  const digestion = describeOperationalCode('OPS-0023');
  const composition = describeOperationalCode('OPS-0024');
  assert.match(digestion.meaning, /digestion rather than the corpus/);
  assert.match(composition.meaning, /genuinely contains no claim/);
  assert.notEqual(digestion.next, composition.next, 'the two causes must not propose the same action');

  // The owner's standing constraint, carried where a future repair will meet it.
  assert.match(digestion.remedy.forbidden, /Never restrict the corpus/);
  assert.match(composition.remedy.forbidden, /Never lower the sameness threshold/);

  // None of these is the immune system's to act on: what the corpus should contain, and what a
  // claim's scope is, are the owner's decisions.
  for (const code of ['OPS-0023', 'OPS-0024', 'OPS-0025', 'OPS-0026']) {
    assert.equal(repairableByImmuneSystem(code), false, `${code} must escalate rather than self-repair`);
  }
});

// Found by mutation: flipping the `&&` in failureCode to `||` left the whole suite green, so
// nothing checked that a code has to be in the registry to count as one. Both guards matter -
// the property path and the message-text path - because an unregistered code reported as
// governed is exactly what the registry exists to prevent.
test('a code that is not in the registry is not a code, whichever way it arrives', () => {
  const onProperty = new Error('something went wrong');
  onProperty.crucibleCode = 'CRU-9999';
  assert.equal(failureCode(onProperty), null, 'an unregistered code on the property must not be reported as governed');
  assert.equal(failureCode(new Error('[CRU-9999] crossed a process boundary')), null, 'nor when it survived only as message text');
  assert.equal(describeCode('CRU-9999'), null);

  // Asserted in both directions on purpose. Without these a function that always returned null
  // would satisfy the assertions above, which is the same masked-assertion trap that let the
  // original mutation survive.
  assert.equal(failureCode(crucibleError('CRU-0002', 'a real classified failure')), 'CRU-0002');
  assert.equal(failureCode(new Error('[CRU-0002] recovered from text alone')), 'CRU-0002');
  assert.equal(operationalCode(operationalError('OPS-0014', 'a governed operational condition')), 'OPS-0014');
});
