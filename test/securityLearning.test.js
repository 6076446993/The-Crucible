'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { securityTechniqueCandidate, queueSecurityTechniques } = require('../src/securityLearning');
const { run } = require('../src/securityLearningCli');

const technique = { id: 'zero-trust-boundary', title: 'Zero-trust custody operations', threat: 'A compromised actor or workflow crosses a trust boundary.', control: 'Every custody operation must verify exact repository, branch, event, actor and cryptographic identity before mutation.', boundary: 'Crucible development key-manager workflow only.', verificationPlan: 'Replay wrong repository, main branch, push event and wrong identity cases; each must fail closed.' };

test('security techniques become candidate-only evidence with provenance and no promotion authority', () => {
  const candidate = securityTechniqueCandidate({ projectId: 'the-crucible', technique, observedAt: '2026-10-09T19:30:00.000Z' });
  assert.equal(candidate.kind, 'security-process-observation');
  assert.equal(candidate.classification, 'Insufficient Evidence');
  assert.equal(candidate.provenance.sourceType, 'owner-provided-security-technique');
  assert.match(candidate.id, /^security-technique-zero-trust-boundary-[a-f0-9]{16}$/);
});

test('security learning refuses to write when durable learning custody is absent', () => {
  const result = queueSecurityTechniques({ projectId: 'the-crucible', techniques: [technique], learningRoot: null });
  assert.equal(result.recorded, false); assert.equal(result.promotionAuthorized, false);
});

test('CLI refuses a manifest that is not explicitly candidate-only', () => {
  assert.throws(() => run(['queue', 'does-not-exist.json'], { CRUCIBLE_LEARNING_ROOT: 'x', CRUCIBLE_LEARNING_PROJECT_ID: 'the-crucible' }), /ENOENT/);
});

test('Security learning CLI respects P0 recovery hold and refuses spoofed hosted identities', () => {
  const common = { GITHUB_REPOSITORY:'6076446993/The-Crucible', CRUCIBLE_LEARNING_ROOT:'x' };
  const fs = require('node:fs'), path = require('node:path');
  const policy = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'governingDocuments', 'recovery-operation-policy.json'), 'utf8'));
  if (policy.mode !== 'normal' || policy.independentRecoveryAccepted !== true) {
    assert.throws(
      () => run(['queue'], { ...common, CRUCIBLE_LEARNING_PROJECT_ID:'github:6076446993/The-Crucible' }),
      /OPS-0049|recovery-only hold/i
    );
  }
  assert.throws(
    () => run(['queue'], { ...common, CRUCIBLE_LEARNING_PROJECT_ID:'github:unrelated/project' }),
    /OPS-0049/
  );
});

test('direct security-technique intake is held before root initialization', () => {
  assert.throws(() => require('../src/securityLearning').queueSecurityTechniques({
    learningRoot:null, projectId:'github:6076446993/The-Crucible', techniques:[],
  }), /OPS-0049|recovery-only hold/i);
});
