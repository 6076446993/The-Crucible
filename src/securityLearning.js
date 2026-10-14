'use strict';

const { makeCandidate, sha } = require('./scientificLearning');
const { createLearningProvenance } = require('./learningProvenance');

const TECHNIQUE_KEYS = Object.freeze(['id', 'title', 'threat', 'control', 'boundary', 'verificationPlan']);

function text(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text.`); }

function validateTechnique(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('security technique must be an object.');
  const extras = Object.keys(value).filter(key => !TECHNIQUE_KEYS.includes(key));
  if (extras.length) throw new Error(`security technique contains unknown field(s): ${extras.join(', ')}.`);
  for (const key of TECHNIQUE_KEYS) text(value[key], `security technique.${key}`);
  if (!/^[a-z0-9-]+$/.test(value.id)) throw new Error('security technique.id must be lowercase kebab-case.');
  return Object.freeze(structuredClone(value));
}

function securityTechniqueCandidate({ projectId, technique, repository = '6076446993/The-Crucible', observedAt = new Date().toISOString() }) {
  text(projectId, 'projectId'); text(repository, 'repository'); text(observedAt, 'observedAt');
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('observedAt must be an ISO timestamp.');
  const value = validateTechnique(technique);
  const source = { projectId, repository, technique: value, observedAt };
  const contentSha256 = sha(source);
  const provenance = createLearningProvenance({ repository, observationId: `security-technique:${value.id}:${contentSha256}`, observedAt, source: 'the-crucible-security-learning' });
  return makeCandidate({
    id: `security-technique-${value.id}-${contentSha256.slice(0, 16)}`,
    projectId,
    claim: value.control,
    claimBoundary: value.boundary,
    generalizationBoundary: 'Candidate security/process evidence applies only to the declared boundary. It requires a falsifiable hypothesis, controlled reproduction, negative and regression testing, contradiction analysis, and independent verification before any promotion.',
    kind: 'security-process-observation',
    provenance: {
      sourceType: 'owner-provided-security-technique',
      sourceId: `security-technique:${value.id}`,
      retrievedAt: observedAt,
      author: 'the-crucible-security-learning',
      license: 'project-private-security-process-evidence',
      contentSha256,
      learningProvenanceId: provenance.learningProvenanceId,
      lifecycleStage: 'observation',
    },
    createdAt: observedAt,
  });
}

function queueSecurityTechniques({ learningRoot, projectId, techniques, repository = '6076446993/The-Crucible', now = () => new Date().toISOString() }) {
  if (!learningRoot) return { recorded: false, reason: 'learning root was not configured', candidateIds: [], promotionAuthorized: false };
  if (!Array.isArray(techniques) || !techniques.length) throw new Error('techniques must be a non-empty array.');
  const { DurableScientificLearningStore } = require('./scientificLearning');
  const store = new DurableScientificLearningStore({ root: learningRoot, projectId });
  const candidates = techniques.map(technique => securityTechniqueCandidate({ projectId, technique, repository, observedAt: now() }));
  const records = store.ingestMany(candidates);
  return { recorded: true, candidateIds: candidates.map(item => item.id), newlyIngested: records.map(item => item.candidate.id), state: 'candidate', promotionAuthorized: false, nextRequiredStage: 'hypothesis', learningRoot, revision: store.read().revision };
}

module.exports = { TECHNIQUE_KEYS, validateTechnique, securityTechniqueCandidate, queueSecurityTechniques };
