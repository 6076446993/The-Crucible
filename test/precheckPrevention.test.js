const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('precheck turns vetted CRU knowledge into a preventive finding before the ordinary gates', async (t) => {
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === './commit') return { auditCommit: () => ({ paths: ['.github/workflows/release.yml'], findings: [] }) };
    if (request === './code-check') return { auditCode: async () => ({ findings: [] }) };
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => { Module._load = originalLoad; delete require.cache[require.resolve('../src/precheck')]; });
  delete require.cache[require.resolve('../src/precheck')];
  const { runPrecheck } = require('../src/precheck');
  const proof = 'a'.repeat(64);
  const result = await runPrecheck('/repo', {}, { prevention: {
    knowledge: [{ version: 1, candidateId: 'candidate-1', proofSha256: proof, boundary: '.github/workflows/', status: 'active' }],
    mappings: [{
      failureCode: 'CRU-0008', knowledgeVersion: 1, knowledgeCandidateId: 'candidate-1', proofSha256: proof,
      boundary: '.github/workflows/', action: 'require-check', paths: ['.github/workflows/'],
      requiredCheck: 'workflow-lint', rationale: 'proven workflow prevention',
    }],
    completedChecks: [],
  }});
  assert.equal(result.findings[0].failureCode, 'CRU-0008');
  assert.equal(result.findings[0].check, 'Learned Prevention');
  assert.equal(result.findings[0].action, 'prevention required');
});


test('scientifically verified prevention knowledge is resolved and consumed by precheck', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { repairObservationCandidate, preventionCandidateFromRepairObservation } = require('../src/repairLearning');
  const { DurableScientificLearningStore, AutonomousScientificLearner, sha } = require('../src/scientificLearning');
  const { mappingsForVettedKnowledge } = require('../src/cruPrevention');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-preflight-proof-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectId = 'the-crucible';
  const at = '2026-09-29T17:00:00.000Z';
  const repair = repairObservationCandidate({
    projectId, repository: 'owner/repo', commitSha: 'verified-repair',
    operation: 'workflow-repair', file: '.github/workflows/release.yml',
    beforeSha256: '1'.repeat(64), afterSha256: '2'.repeat(64),
    failureCode: 'CRU-0008', canonicalFailureId: 'CF-workflow-config', observedAt: at,
  });
  const candidate = preventionCandidateFromRepairObservation({
    repairCandidate: repair, precursorPaths: ['.github/workflows/'], requiredCheck: 'workflow-lint',
    rationale: 'Controlled workflow validation prevents recurrence of the classified workflow defect.', observedAt: at,
  });
  const store = new DurableScientificLearningStore({ root, projectId });
  store.ingest(candidate);
  const hypothesis = 'If workflow-lint is required before execution for changes under .github/workflows/, the tested CRU-0008 precursor is detected before the workflow executes.';
  const experimentExecutor = {
    id: 'controlled-workflow-fixture-runner',
    run: async ({ candidate: input, hypothesis: persisted }) => ({
      schemaVersion: 1, candidateId: input.id, projectId, hypothesis: persisted,
      testedProperty: input.claim, experimentBoundary: input.claimBoundary,
      controls: ['valid workflow fixture passes workflow-lint and remains executable'],
      causalIsolation: { method: 'single-variable invalid workflow mutation', result: 'workflow-lint fails only after the invalid workflow mutation is introduced', correlationOnly: false },
      negativeTests: ['source-file change outside .github/workflows/ does not trigger this prevention boundary'],
      regressionTests: ['valid workflow fixture still passes workflow-lint'],
      scopeProof: 'experiment modifies only the declared .github/workflows/ fixture boundary',
      generalizationResult: 'no claim beyond the declared workflow path boundary',
      contradictionResult: 'none', completedAt: at,
    }),
  };
  const independentVerifier = {
    id: 'independent-workflow-fixture-verifier',
    run: async ({ candidate: input, experimentalProof }) => ({
      verifierId: 'independent-workflow-fixture-verifier', independent: true,
      testedProperty: input.claim, experimentBoundary: experimentalProof.experimentBoundary,
      result: 'passed', verifiedAt: at,
    }),
  };
  const learner = new AutonomousScientificLearner({ store, experimentExecutor, independentVerifier, now: () => at });
  const verified = await learner.process(candidate.id, hypothesis);
  assert.equal(verified.state, 'verified');
  assert.equal(Object.values(verified.gates).every(Boolean), true);

  const payload = store.read();
  const knowledge = payload.knowledgeVersions.filter((item) => item.status === 'active');
  assert.equal(knowledge.length, 1);
  assert.equal(knowledge[0].proofSha256, sha(verified.proof));
  const declarations = [{
    failureCode: 'CRU-0008', precursorPaths: ['.github/workflows/'], requiredCheck: 'workflow-lint',
    action: 'require-check', rationale: 'Controlled workflow validation prevents recurrence of the classified workflow defect.',
  }];
  const mappings = mappingsForVettedKnowledge({ knowledge, candidateRecords: payload.candidateRecords, declarations });

  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === './commit') return { auditCommit: () => ({ paths: ['.github/workflows/release.yml'], findings: [] }) };
    if (request === './code-check') return { auditCode: async () => ({ findings: [] }) };
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => { Module._load = originalLoad; delete require.cache[require.resolve('../src/precheck')]; });
  delete require.cache[require.resolve('../src/precheck')];
  const { runPrecheck } = require('../src/precheck');
  const blocked = await runPrecheck('/repo', {}, { prevention: { knowledge, mappings, completedChecks: [] } });
  assert.equal(blocked.findings[0].failureCode, 'CRU-0008');
  assert.equal(blocked.findings[0].action, 'prevention required');

  const allowed = await runPrecheck('/repo', {}, { prevention: { knowledge, mappings, completedChecks: ['workflow-lint'] } });
  assert.equal(allowed.findings.some((finding) => finding.failureCode === 'CRU-0008'), false);
});
