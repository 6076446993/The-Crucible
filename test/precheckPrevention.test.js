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
