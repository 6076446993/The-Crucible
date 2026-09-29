const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OutcomeStore, learningPolicyCandidate } = require('../src/adaptiveLearning');
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
    evidenceOutcomeIds:['o-1','o-2'], claimBoundary:'CRU-0008 within .github/workflows/',
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
    evidenceOutcomeIds:['o-1','o-2'], claimBoundary:'workflow-only',
  }), /measured improvement/);
});
