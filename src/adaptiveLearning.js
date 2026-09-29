'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { makeCandidate, sha } = require('./scientificLearning');

const OUTCOMES = Object.freeze(['prevented', 'bypassed', 'false-positive', 'missed', 'repair-succeeded', 'repair-failed']);
const POLICY_KIND = 'learning-policy-candidate';

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text.`);
  return value.trim();
}
function iso(value, label) {
  text(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp.`);
}
function metric(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

function outcomeRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('outcome must be an object.');
  const outcome = text(input.outcome, 'outcome');
  if (!OUTCOMES.includes(outcome)) throw new Error(`outcome must be one of: ${OUTCOMES.join(', ')}.`);
  const observedAt = input.observedAt || new Date().toISOString();
  iso(observedAt, 'observedAt');
  const record = {
    schemaVersion: 1,
    projectId: text(input.projectId, 'projectId'),
    outcomeId: text(input.outcomeId, 'outcomeId'),
    lifecycle: text(input.lifecycle, 'lifecycle'),
    outcome,
    failureCode: input.failureCode || null,
    canonicalFailureId: input.canonicalFailureId || null,
    repairCandidateId: input.repairCandidateId || null,
    preventionRuleId: input.preventionRuleId || null,
    knowledgeVersion: input.knowledgeVersion ?? null,
    changedPaths: [...new Set(input.changedPaths || [])].sort(),
    completedChecks: [...new Set(input.completedChecks || [])].sort(),
    expected: text(input.expected, 'expected'),
    actual: text(input.actual, 'actual'),
    observedAt,
  };
  if (record.failureCode !== null && !/^CRU-\d{4}$/.test(record.failureCode)) throw new Error('failureCode must be null or CRU-####.');
  if (record.knowledgeVersion !== null && (!Number.isSafeInteger(record.knowledgeVersion) || record.knowledgeVersion < 1)) throw new Error('knowledgeVersion must be null or a positive integer.');
  return Object.freeze(record);
}

class OutcomeStore {
  constructor(root, projectId) {
    this.root = path.resolve(text(root, 'root')); this.projectId = text(projectId, 'projectId');
    fs.mkdirSync(this.root, { recursive: true });
    this.file = path.join(this.root, `${sha(projectId)}.outcomes.json`);
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, JSON.stringify({ schemaVersion:1, projectId, outcomes:[] }, null, 2) + '\n');
  }
  read() {
    const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (value.schemaVersion !== 1 || value.projectId !== this.projectId || !Array.isArray(value.outcomes)) throw new Error('outcome store identity is invalid.');
    return value;
  }
  record(input) {
    const record = outcomeRecord(input);
    if (record.projectId !== this.projectId) throw new Error('Cross-project outcome evidence is forbidden.');
    const value = this.read();
    if (!value.outcomes.some((item) => item.outcomeId === record.outcomeId)) {
      value.outcomes.push(record);
      const temporary = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
      fs.renameSync(temporary, this.file);
    }
    return record;
  }
}

function learningPolicyCandidate({ projectId, policyArea, currentStrategy, proposedStrategy, metricName, baseline, proposed, evidenceOutcomeIds, claimBoundary, observedAt = new Date().toISOString() }) {
  text(policyArea, 'policyArea'); text(currentStrategy, 'currentStrategy'); text(proposedStrategy, 'proposedStrategy'); text(metricName, 'metricName'); text(claimBoundary, 'claimBoundary');
  metric(baseline, 'baseline'); metric(proposed, 'proposed'); iso(observedAt, 'observedAt');
  if (!Array.isArray(evidenceOutcomeIds) || evidenceOutcomeIds.length < 2 || evidenceOutcomeIds.some((id) => typeof id !== 'string' || !id.trim())) throw new Error('learning-policy candidates require at least two outcome evidence ids.');
  if (proposed <= baseline) throw new Error('learning-policy candidates require a measured improvement over baseline.');
  const evidence = { policyArea, currentStrategy, proposedStrategy, metricName, baseline, proposed, evidenceOutcomeIds:[...new Set(evidenceOutcomeIds)].sort(), claimBoundary };
  return makeCandidate({
    id: `learning-policy-candidate-${sha(evidence)}`, projectId,
    claim: `Within ${claimBoundary}, learning strategy "${proposedStrategy}" improves ${metricName} from ${baseline} to ${proposed} compared with "${currentStrategy}".`,
    claimBoundary,
    generalizationBoundary: 'Learning-policy adaptation is limited to the measured boundary. Activation requires controlled reproduction, causal isolation, regression/negative testing, independent verification, and rollback-capable versioning.',
    kind: POLICY_KIND,
    provenance: {
      sourceType: 'repair-prevention-outcome-analysis', sourceId: `meta-learning:${sha(evidence)}`,
      retrievedAt: observedAt, author: 'the-crucible-meta-learning', license: 'project-private-outcome-evidence',
      contentSha256: sha(evidence), lifecycleStage: 'learning-policy-candidate',
    },
    createdAt: observedAt,
  });
}

module.exports = { OUTCOMES, POLICY_KIND, outcomeRecord, OutcomeStore, learningPolicyCandidate };
