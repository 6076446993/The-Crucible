const fs = require('node:fs');
const path = require('node:path');
const { makeCandidate, sha } = require('./scientificLearning');
const { createLearningProvenance } = require('./learningProvenance');

const EXPERIENCE_KEYS = Object.freeze([
  'schemaVersion', 'projectId', 'attemptId', 'boundedClaim', 'claimBoundary',
  'generalizationBoundary', 'action', 'environment', 'expectedOutcome',
  'actualOutcome', 'outcome', 'failureCode', 'failureCodeStatus', 'actionSha256', 'environmentSha256',
  'resultSha256', 'artifactSha256', 'actorId', 'observedAt',
  'evidencePacket',
]);

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text.`);
}
function digest(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value || '')) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
}
function validateExperience(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('experience must be an object.');
  const extras = Object.keys(value).filter((key) => !EXPERIENCE_KEYS.includes(key));
  if (extras.length) throw new Error(`experience contains unknown field(s): ${extras.join(', ')}.`);
  if (value.schemaVersion !== 1) throw new Error('experience.schemaVersion must be 1.');
  for (const key of ['projectId', 'attemptId', 'boundedClaim', 'claimBoundary', 'generalizationBoundary', 'action', 'environment', 'expectedOutcome', 'actualOutcome', 'actorId']) text(value[key], `experience.${key}`);
  if (!['succeeded', 'failed'].includes(value.outcome)) throw new Error('experience.outcome must be succeeded or failed.');
  if (value.failureCode !== undefined && !/^CRU-\d{4}$/.test(value.failureCode)) throw new Error('experience.failureCode must be a CRU-#### code.');
  if (value.failureCodeStatus !== undefined && !['registered', 'pending-registration'].includes(value.failureCodeStatus)) throw new Error('experience.failureCodeStatus must be registered or pending-registration.');
  for (const key of ['actionSha256', 'environmentSha256', 'resultSha256', 'artifactSha256']) digest(value[key], `experience.${key}`);
  if (value.evidencePacket) {
    const packet = require('./evidencePacket').validateEvidencePacket(value.evidencePacket);
    if (!packet.valid) throw new Error(`experience.evidencePacket is invalid: ${[...packet.missing, ...packet.errors].join(' ')}`);
  }
  if (!Number.isFinite(Date.parse(value.observedAt))) throw new Error('experience.observedAt must be an ISO timestamp.');
  return Object.freeze(structuredClone(value));
}

function experienceCandidate(value) {
  const experience = validateExperience(value);
  const contentSha256 = sha(experience);
  return makeCandidate({
    id: `experience-${contentSha256}`,
    projectId: experience.projectId,
    claim: experience.boundedClaim,
    claimBoundary: experience.claimBoundary,
    generalizationBoundary: experience.generalizationBoundary,
    kind: 'experience-observation',
    provenance: {
      sourceType: 'bounded-task-experience',
      ...(experience.failureCode ? { failureCode: experience.failureCode, failureCodeStatus: experience.failureCodeStatus } : {}),
      learningProvenanceId: createLearningProvenance({ repository: process.env.GITHUB_REPOSITORY || experience.projectId, observationId: experience.attemptId, observedAt: experience.observedAt, source: 'the-crucible-experience-recorder' }).learningProvenanceId,
      lifecycleStage: 'observation',
      sourceId: experience.attemptId,
      retrievedAt: experience.observedAt,
      author: experience.actorId,
      license: 'project-private-experience-evidence',
      contentSha256,
    },
    ...(experience.evidencePacket ? { evidencePacket: experience.evidencePacket } : {}),
    createdAt: experience.observedAt,
  });
}

class LearningExperienceRecorder {
  constructor({ store, projectId }) {
    if (!store || typeof store.ingestMany !== 'function') throw new Error('A durable scientific-learning store is required.');
    text(projectId, 'projectId');
    if (store.projectId !== projectId) throw new Error('Experience recorder and store must use the same project identity.');
    this.store = store;
    this.projectId = projectId;
  }
  record(experiences) {
    if (!Array.isArray(experiences) || !experiences.length) throw new Error('experiences must be a non-empty array.');
    const candidates = experiences.map(experienceCandidate);
    const ids = new Set(candidates.map((candidate) => candidate.id));
    if (ids.size !== candidates.length) throw new Error('Experience batch contains duplicate observations.');
    return this.store.ingestMany(candidates);
  }
}

module.exports = { EXPERIENCE_KEYS, validateExperience, experienceCandidate, LearningExperienceRecorder, parseDevlogSessions, ingestDevlog };


function parseDevlogSessions(content) {
  const text = String(content || '');
  const matches = [...text.matchAll(/^### Session:\s*(.+)$/gm)];
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    return { heading: match[1].trim(), body: text.slice(start, end).trim() };
  });
}

function ingestDevlog({ root = process.cwd(), learningRoot, projectId, repository, devlogPath = 'DEVLOG.md', observedAt = new Date().toISOString() }) {
  if (!learningRoot) return { recorded: false, reason: 'learning root was not configured', candidateIds: [] };
  if (!projectId) throw new TypeError('projectId is required.');
  if (!repository) throw new TypeError('repository is required.');
  const file = path.resolve(root, devlogPath);
  if (!fs.existsSync(file)) return { recorded: false, reason: `devlog not found: ${devlogPath}`, candidateIds: [] };
  const sessions = parseDevlogSessions(fs.readFileSync(file, 'utf8'));
  if (!sessions.length) return { recorded: false, reason: 'devlog contains no session records', candidateIds: [] };
  const { DurableScientificLearningStore } = require('./scientificLearning');
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId });
  const candidates = sessions.map((session) => {
    const contentSha256 = sha({ heading: session.heading, body: session.body });
    const provenance = createLearningProvenance({ repository, observationId: `devlog:${devlogPath}:${contentSha256}`, observedAt, source: 'the-crucible-devlog' });
    return makeCandidate({
      id: `devlog-experience-${contentSha256}`,
      projectId,
      claim: `The Crucible recorded an engineering experience in DEVLOG: ${session.heading}`,
      claimBoundary: `Repository ${repository}; DEVLOG.md session "${session.heading}".`,
      generalizationBoundary: 'A development-log entry is experience evidence, not a verified generalized rule. It must not be promoted without investigation, verification, and governance.',
      kind: 'devlog-experience',
      provenance: {
        sourceType: 'development-log',
        sourceId: `devlog:${devlogPath}:${contentSha256}`,
        retrievedAt: observedAt,
        author: 'the-crucible-devlog-ingester',
        license: 'project-private-engineering-history',
        contentSha256,
        learningProvenanceId: provenance.learningProvenanceId,
        lifecycleStage: 'observation',
      },
      createdAt: observedAt,
    });
  });
  const records = store.ingestMany(candidates);
  return { recorded: true, candidateIds: candidates.map((candidate) => candidate.id), newlyIngested: records.map((record) => record.candidate.id), learningRoot, revision: store.read().revision, promotionAuthorized: false, note: 'DEVLOG entries are automatically ingested as experience evidence. They are never automatically promoted to vetted learning.' };
}

if (require.main === module && process.argv[2] === 'ingest-devlog') {
  const result = ingestDevlog({
    root: process.cwd(),
    learningRoot: process.env.CRUCIBLE_LEARNING_ROOT,
    projectId: process.env.CRUCIBLE_PROJECT_ID || 'the-crucible',
    repository: process.env.GITHUB_REPOSITORY || 'local/The-Crucible',
    devlogPath: process.env.CRUCIBLE_DEVLOG_PATH || 'DEVLOG.md',
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.recorded ? 0 : 1;
}
