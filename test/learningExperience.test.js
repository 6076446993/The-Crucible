const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseDevlogSessions, ingestDevlog } = require('../src/learningExperience');
const { DurableScientificLearningStore } = require('../src/scientificLearning');

test('parses DEVLOG sessions as discrete experience records', () => {
  const sessions = parseDevlogSessions('# Development log\n\n### Session: First\n\nFixed A.\n\n### Session: Second\n\nFixed B.\n');
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].heading, 'First');
  assert.equal(sessions[1].body, 'Fixed B.');
});

test('ingests DEVLOG entries as non-promotable experience evidence with provenance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-devlog-learning-'));
  const learningRoot = path.join(root, 'learning');
  fs.writeFileSync(path.join(root, 'DEVLOG.md'), '# Development log\n\n### Session: Repair\n\nSymptom was observed. Root cause was investigated.\n');
  const result = ingestDevlog({
    root,
    learningRoot,
    projectId: 'the-crucible',
    repository: 'jonathanblunt1214-lgtm/The-Crucible',
    observedAt: '2026-09-28T00:00:00.000Z',
  });
  assert.equal(result.recorded, true);
  assert.equal(result.promotionAuthorized, false);
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId: 'the-crucible' });
  const record = store.get(result.candidateIds[0]);
  assert.equal(record.state, 'candidate');
  assert.equal(record.candidate.kind, 'devlog-experience');
  assert.match(record.candidate.provenance.learningProvenanceId, /^LP-[a-f0-9]{16}$/);
});
