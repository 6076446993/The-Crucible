const test = require('node:test');
const assert = require('node:assert/strict');
const { mappingsForVettedKnowledge, preventionRule, rulesFromVettedKnowledge, evaluatePrevention, enforcePrevention, recordPreventionAdjudication } = require('../src/cruPrevention');

const PROOF = 'a'.repeat(64);
const RULE = {
  failureCode: 'CRU-0008',
  knowledgeVersion: 7,
  knowledgeCandidateId: 'candidate-workflow-permissions',
  proofSha256: PROOF,
  boundary: '.github/workflows/',
  action: 'require-check',
  paths: ['.github/workflows/'],
  requiredCheck: 'workflow-lint',
  rationale: 'Verified history established invalid workflow configuration as preventable by validation before execution.',
};

test('a prevention rule must point to an active CRU bug/error class', () => {
  assert.equal(preventionRule(RULE).failureCode, 'CRU-0008');
  assert.throws(() => preventionRule({ ...RULE, failureCode: 'CRU-0052' }), /not an active CRU/);
  assert.throws(() => preventionRule({ ...RULE, failureCode: 'CRU-9999' }), /not an active CRU/);
});

test('only active vetted knowledge can instantiate a prevention rule', () => {
  const knowledge = [{ version: 7, candidateId: RULE.knowledgeCandidateId, proofSha256: PROOF, boundary: RULE.boundary, status: 'active' }];
  assert.equal(rulesFromVettedKnowledge({ knowledge, mappings: [RULE] }).length, 1);
  assert.deepEqual(rulesFromVettedKnowledge({ knowledge: [{ ...knowledge[0], status: 'rolled-back' }], mappings: [RULE] }), []);
  assert.throws(() => rulesFromVettedKnowledge({ knowledge, mappings: [{ ...RULE, proofSha256: 'b'.repeat(64) }] }), /proof does not match/);
});

test('vetted knowledge prevents the precursor until its required check has passed', () => {
  const finding = evaluatePrevention({ rules: [RULE], changedPaths: ['.github/workflows/release.yml'], completedChecks: [] });
  assert.equal(finding.length, 1);
  assert.equal(finding[0].failureCode, 'CRU-0008');
  assert.equal(finding[0].knowledgeVersion, 7);
  assert.throws(() => enforcePrevention({ rules: [RULE], changedPaths: ['.github/workflows/release.yml'], completedChecks: [] }), /CRU-0008/);
  assert.deepEqual(evaluatePrevention({ rules: [RULE], changedPaths: ['.github/workflows/release.yml'], completedChecks: ['workflow-lint'] }), []);
});

test('prevention stays inside the experimentally verified boundary', () => {
  assert.deepEqual(evaluatePrevention({ rules: [RULE], changedPaths: ['src/index.js'], completedChecks: [] }), []);
});


test('verified candidate custody resolves to a governed prevention rule without broadening its boundary', () => {
  const knowledge = [{ version: 7, candidateId: RULE.knowledgeCandidateId, proofSha256: PROOF, boundary: RULE.boundary, status: 'active' }];
  const candidateRecords = [{
    state: 'verified',
    candidate: {
      id: RULE.knowledgeCandidateId,
      claimBoundary: RULE.boundary,
      provenance: { failureCode: 'CRU-0008' },
    },
  }];
  const declarations = [{
    failureCode: 'CRU-0008', precursorPaths: ['.github/workflows/'], requiredCheck: 'workflow-lint',
    action: 'require-check', rationale: RULE.rationale,
  }];
  const mappings = mappingsForVettedKnowledge({ knowledge, candidateRecords, declarations });
  assert.deepEqual(mappings, [RULE]);
  assert.equal(rulesFromVettedKnowledge({ knowledge, mappings }).length, 1);
  assert.throws(() => mappingsForVettedKnowledge({
    knowledge: [{ ...knowledge[0], boundary: 'all-repository-paths' }], candidateRecords, declarations,
  }), /boundary does not match/);
});


test('prevention execution records outcome evidence for later adaptive learning', () => {
  const recorded = [];
  const outcomeRecorder = { record: (value) => { recorded.push(value); return value; } };
  const findings = evaluatePrevention({
    rules:[RULE], changedPaths:['.github/workflows/release.yml'], completedChecks:[],
    outcomeRecorder, projectId:'the-crucible', observedAt:() => '2026-09-29T17:15:00.000Z',
  });
  assert.equal(findings.length, 1);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].outcome, 'triggered');
  assert.equal(recorded[0].failureCode, 'CRU-0008');
  assert.equal(recorded[0].knowledgeVersion, 7);
});


test('only actual enforcement records prevented and explicit bypass records bypassed', () => {
  const recorded = []; const outcomeRecorder = { record:value => (recorded.push(value), value) };
  assert.throws(() => enforcePrevention({ rules:[RULE], changedPaths:['.github/workflows/release.yml'], completedChecks:[], outcomeRecorder, projectId:'the-crucible', observedAt:()=>'2026-09-29T18:20:00.000Z' }), /blocked/);
  assert.equal(recorded[0].outcome, 'prevented');
  recorded.length = 0;
  const result = enforcePrevention({ rules:[RULE], changedPaths:['.github/workflows/release.yml'], completedChecks:[], outcomeRecorder, projectId:'the-crucible', bypass:true, bypassReason:'approved emergency exception', observedAt:()=>'2026-09-29T18:21:00.000Z' });
  assert.equal(result.bypassed, true); assert.equal(recorded[0].outcome, 'bypassed');
});

test('missed false-positive and failed-prevention require explicit adjudication evidence', () => {
  const recorded = []; const outcomeRecorder = { record:value => (recorded.push(value), value) };
  const finding = evaluatePrevention({ rules:[RULE], changedPaths:['.github/workflows/release.yml'], completedChecks:[] })[0];
  for (const outcome of ['missed','false-positive','failed-prevention']) recordPreventionAdjudication({ outcomeRecorder, projectId:'the-crucible', finding, outcome, actual:`verified adjudication: ${outcome}`, observedAt:()=>'2026-09-29T18:22:00.000Z' });
  assert.deepEqual(recorded.map(x=>x.outcome), ['missed','false-positive','failed-prevention']);
});
