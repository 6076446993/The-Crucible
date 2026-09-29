const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OutcomeStore, learningPolicyCandidate, LearningPolicyStore } = require('../src/adaptiveLearning');
const { DurableScientificLearningStore } = require('../src/scientificLearning');

test('repair and prevention outcomes are durable evidence, not CRU classifications', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-outcomes-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const store = new OutcomeStore(root, 'the-crucible');
  store.record({
    projectId:'the-crucible', outcomeId:'o-1', lifecycle:'prevention', outcome:'prevented',
    failureCode:'CRU-0008', preventionRuleId:'prevent-CRU-0008-v1', knowledgeVersion:1,
    changedPaths:['.github/workflows/release.yml'], completedChecks:[],
    expected:'workflow-lint required before execution', actual:'preflight prevented execution until workflow-lint', observedAt:'2026-09-29T17:10:00.000Z',
  });
  store.record({
    projectId:'the-crucible', outcomeId:'o-2', lifecycle:'repair', outcome:'repair-succeeded',
    failureCode:'CRU-0008', repairCandidateId:'repair-1', changedPaths:['.github/workflows/release.yml'], completedChecks:['workflow-lint'],
    expected:'repair restores valid workflow', actual:'workflow-lint passes after repair', observedAt:'2026-09-29T17:11:00.000Z',
  });
  assert.equal(store.read().outcomes.length, 2);
  assert.equal(store.read().outcomes[0].outcome, 'prevented');
});

test('measured outcome improvement can propose but never directly activate a learning-policy change', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-meta-learning-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const candidate = learningPolicyCandidate({
    projectId:'the-crucible', policyArea:'workflow failure learning',
    currentStrategy:'repair-only analysis', proposedStrategy:'repair plus precursor-outcome analysis',
    metricName:'bounded prevention detection rate', baseline:0.5, proposed:0.8,
    evidenceOutcomeIds:['o-1','o-2','o-3'], claimBoundary:'CRU-0008 within .github/workflows/',
    observedAt:'2026-09-29T17:12:00.000Z',
  });
  const learning = new DurableScientificLearningStore({ root, projectId:'the-crucible' });
  const record = learning.ingest(candidate);
  assert.equal(record.state, 'candidate');
  assert.equal(record.candidate.kind, 'learning-policy-candidate');
  assert.equal(learning.activeKnowledge().length, 0);
  assert.throws(() => learningPolicyCandidate({
    projectId:'the-crucible', policyArea:'workflow failure learning',
    currentStrategy:'current', proposedStrategy:'worse', metricName:'detection', baseline:0.8, proposed:0.7,
    evidenceOutcomeIds:['o-1','o-2','o-3'], claimBoundary:'workflow-only',
  }), /measured improvement/);
});


test('lower-is-better metrics and minimum distinct evidence are enforced', () => {
  const candidate = learningPolicyCandidate({
    projectId:'the-crucible', policyArea:'repair efficiency', currentStrategy:'slow', proposedStrategy:'faster',
    metricName:'mean repair latency', metricDirection:'minimize', baseline:12, proposed:8,
    evidenceOutcomeIds:['a','b','c'], claimBoundary:'internal repair',
  });
  assert.equal(candidate.kind, 'learning-policy-candidate');
  assert.throws(() => learningPolicyCandidate({
    projectId:'the-crucible', policyArea:'repair efficiency', currentStrategy:'slow', proposedStrategy:'unsupported',
    metricName:'mean repair latency', metricDirection:'minimize', baseline:12, proposed:8,
    evidenceOutcomeIds:['a','a','b'], claimBoundary:'internal repair',
  }), /distinct outcome evidence/);
});

test('learning policy activation is verified versioned and rollbackable', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-policy-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const policies = new LearningPolicyStore(root, 'the-crucible');
  const candidate = learningPolicyCandidate({
    projectId:'the-crucible', policyArea:'workflow learning', currentStrategy:'v1', proposedStrategy:'v2',
    metricName:'detection', baseline:0.5, proposed:0.8, evidenceOutcomeIds:['a','b','c'], claimBoundary:'workflow-only',
    observedAt:'2026-09-29T18:10:00.000Z',
  });
  assert.throws(() => policies.activate({ verifiedRecord:{ state:'candidate', candidate }, knowledgeVersion:1, strategy:'v2', policyArea:'workflow learning', boundary:'workflow-only', approvedBy:'oversight' }), /scientifically verified/);
  const verified = { state:'verified', candidate, proof:{ experimentBoundary:'workflow-only', result:'verified' } };
  const v1 = policies.activate({ verifiedRecord:verified, knowledgeVersion:1, strategy:'v2', policyArea:'workflow learning', boundary:'workflow-only', approvedBy:'oversight', at:'2026-09-29T18:11:00.000Z' });
  const candidate2 = learningPolicyCandidate({
    projectId:'the-crucible', policyArea:'workflow learning', currentStrategy:'v2', proposedStrategy:'v3',
    metricName:'detection', baseline:0.8, proposed:0.9, evidenceOutcomeIds:['d','e','f'], claimBoundary:'workflow-only',
    observedAt:'2026-09-29T18:12:00.000Z',
  });
  const v2 = policies.activate({ verifiedRecord:{ state:'verified', candidate:candidate2, proof:{ experimentBoundary:'workflow-only', result:'verified-v3' } }, knowledgeVersion:2, strategy:'v3', policyArea:'workflow learning', boundary:'workflow-only', approvedBy:'oversight', at:'2026-09-29T18:13:00.000Z' });
  assert.equal(v2.previousVersion, v1.version);
  assert.equal(policies.active()[0].strategy, 'v3');
  policies.rollback(v1.version, { reason:'regression evidence', approvedBy:'oversight', at:'2026-09-29T18:14:00.000Z' });
  assert.equal(policies.active()[0].strategy, 'v2');
});
