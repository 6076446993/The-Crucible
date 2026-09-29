const test = require('node:test');
const assert = require('node:assert/strict');
const { preventionRule, rulesFromVettedKnowledge, evaluatePrevention, enforcePrevention } = require('../src/cruPrevention');

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
