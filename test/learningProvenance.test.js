const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createLearningProvenance,
  appendProvenanceStage,
  createPostmortem,
  significantFailureRequiresPostmortem,
} = require('../src/learningProvenance');

test('creates a stable Learning Provenance ID from incident identity', () => {
  const a = createLearningProvenance({
    repository: 'jonathanblunt1214-lgtm/The-Crucible',
    pullRequest: 28,
    failureCode: 'CRU-0006',
    observationId: 'pr-28-CRU-0006',
    observedAt: '2026-09-28T21:28:02.000Z',
  });
  const b = createLearningProvenance({
    repository: 'jonathanblunt1214-lgtm/The-Crucible',
    pullRequest: 28,
    failureCode: 'CRU-0006',
    observationId: 'pr-28-CRU-0006',
    observedAt: '2026-09-28T21:28:02.000Z',
  });
  assert.equal(a.learningProvenanceId, b.learningProvenanceId);
  assert.equal(a.lifecycle[0].state, 'recorded');
  assert.equal(a.lifecycle[7].state, 'not-yet-eligible');
});

test('keeps the repair and verification chain explicit', () => {
  const p = createLearningProvenance({
    repository: 'example/repo',
    observationId: 'obs-1',
    observedAt: '2026-09-28T00:00:00.000Z',
  });
  const repaired = appendProvenanceStage(p, {
    stage: 'repair',
    recordId: 'REP-1',
    evidence: ['commit:abc'],
  });
  const verified = appendProvenanceStage(repaired, {
    stage: 'verification',
    recordId: 'VER-1',
    status: 'verified',
    evidence: ['check:green'],
  });
  assert.deepEqual(verified.chain.map((x) => x.stage), ['repair', 'verification']);
  assert.equal(verified.lifecycle.find((x) => x.stage === 'verification').state, 'verified');
});

test('postmortems require both root cause and systemic cause', () => {
  const pm = createPostmortem({
    learningProvenanceId: 'LP-123',
    postmortemId: 'PM-1',
    symptom: 'monitor exited with code 1',
    rootCause: 'monitor used the security-read secret for ordinary GitHub API reads',
    systemicCause: 'credential boundaries were not separated between repository monitoring and security configuration checks',
    correctiveActions: ['Use GITHUB_TOKEN for ordinary monitor reads'],
    preventiveActions: ['Add a regression test for token selection'],
    verificationEvidence: ['test:nexus-check-monitor'],
    lessonsLearned: ['A repair that clears a symptom is not sufficient evidence of a systemic fix'],
  });
  assert.equal(pm.promotionEligible, true);
  assert.equal(pm.rootCause.includes('security-read'), true);
});

test('significant security and governance failures require postmortems', () => {
  assert.equal(significantFailureRequiresPostmortem({ severity: 'critical' }), true);
  assert.equal(significantFailureRequiresPostmortem({ category: 'security' }), true);
  assert.equal(significantFailureRequiresPostmortem({ severity: 'low', category: 'utility' }), false);
});
