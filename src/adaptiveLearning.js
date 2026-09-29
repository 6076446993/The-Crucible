'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { makeCandidate, sha } = require('./scientificLearning');

const OUTCOMES = Object.freeze(['triggered', 'prevented', 'bypassed', 'false-positive', 'missed', 'failed-prevention', 'repair-succeeded', 'repair-failed']);
const METRIC_DIRECTIONS = Object.freeze(['maximize', 'minimize']);
const MIN_POLICY_EVIDENCE = 3;
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

function learningPolicyCandidate({ projectId, policyArea, currentStrategy, proposedStrategy, metricName, metricDirection = 'maximize', baseline, proposed, evidenceOutcomeIds, minimumEvidence = MIN_POLICY_EVIDENCE, claimBoundary, observedAt = new Date().toISOString() }) {
  text(policyArea, 'policyArea'); text(currentStrategy, 'currentStrategy'); text(proposedStrategy, 'proposedStrategy'); text(metricName, 'metricName'); text(claimBoundary, 'claimBoundary');
  metric(baseline, 'baseline'); metric(proposed, 'proposed'); iso(observedAt, 'observedAt');
  if (!METRIC_DIRECTIONS.includes(metricDirection)) throw new Error(`metricDirection must be one of: ${METRIC_DIRECTIONS.join(', ')}.`);
  if (!Number.isSafeInteger(minimumEvidence) || minimumEvidence < MIN_POLICY_EVIDENCE) throw new Error(`minimumEvidence must be an integer >= ${MIN_POLICY_EVIDENCE}.`);
  const ids = Array.isArray(evidenceOutcomeIds) ? [...new Set(evidenceOutcomeIds.map((id) => text(id, 'evidence outcome id')))] : [];
  if (ids.length < minimumEvidence) throw new Error(`learning-policy candidates require at least ${minimumEvidence} distinct outcome evidence ids.`);
  const improved = metricDirection === 'maximize' ? proposed > baseline : proposed < baseline;
  if (!improved) throw new Error('learning-policy candidates require a measured improvement over baseline in the declared metric direction.');
  const evidence = { policyArea, currentStrategy, proposedStrategy, metricName, metricDirection, baseline, proposed, minimumEvidence, evidenceOutcomeIds:ids.sort(), claimBoundary };
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


class LearningPolicyStore {
  constructor(root, projectId) {
    this.root = path.resolve(text(root, 'root')); this.projectId = text(projectId, 'projectId');
    fs.mkdirSync(this.root, { recursive:true });
    this.file = path.join(this.root, `${sha(projectId)}.policies.json`);
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, JSON.stringify({ schemaVersion:1, projectId, revision:0, policies:[] }, null, 2) + '\n');
  }
  read() {
    const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (value.schemaVersion !== 1 || value.projectId !== this.projectId || !Number.isSafeInteger(value.revision) || !Array.isArray(value.policies)) throw new Error('learning policy store identity is invalid.');
    return value;
  }
  write(value) {
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n'); fs.renameSync(temporary, this.file);
  }
  activate({ verifiedRecord, knowledgeVersion, strategy, policyArea, boundary, approvedBy, at = new Date().toISOString() }) {
    iso(at, 'activation.at'); text(strategy, 'strategy'); text(policyArea, 'policyArea'); text(boundary, 'boundary'); text(approvedBy, 'approvedBy');
    if (!verifiedRecord || verifiedRecord.state !== 'verified' || verifiedRecord.candidate?.kind !== POLICY_KIND) throw new Error('Only a scientifically verified learning-policy candidate may be activated.');
    if (verifiedRecord.candidate.projectId !== this.projectId) throw new Error('Cross-project learning policy activation is forbidden.');
    if (verifiedRecord.candidate.claimBoundary !== boundary || verifiedRecord.proof?.experimentBoundary !== boundary) throw new Error('Learning policy activation boundary must exactly match verified proof.');
    if (!Number.isSafeInteger(knowledgeVersion) || knowledgeVersion < 1) throw new Error('knowledgeVersion must be a positive integer.');
    const value = this.read();
    const prior = value.policies.findLast((item) => item.policyArea === policyArea && item.boundary === boundary && item.status === 'active') || null;
    if (prior) prior.status = 'superseded';
    const policy = { version:value.policies.length + 1, projectId:this.projectId, policyArea, boundary, strategy, candidateId:verifiedRecord.candidate.id, knowledgeVersion, proofSha256:sha(verifiedRecord.proof), previousVersion:prior?.version || null, approvedBy, activatedAt:at, status:'active' };
    value.policies.push(policy); value.revision += 1; this.write(value); return Object.freeze({ ...policy });
  }
  rollback(targetVersion, { reason, approvedBy, at = new Date().toISOString() }) {
    text(reason, 'rollback.reason'); text(approvedBy, 'approvedBy'); iso(at, 'rollback.at');
    const value = this.read(); const target = value.policies.find((item) => item.version === targetVersion);
    if (!target) throw new Error('Learning policy rollback target does not exist.');
    for (const item of value.policies) if (item.policyArea === target.policyArea && item.boundary === target.boundary && item.status === 'active') item.status = 'rolled-back';
    target.status = 'active'; target.rollback = { reason, approvedBy, at }; value.revision += 1; this.write(value); return Object.freeze({ ...target });
  }
  active({ policyArea, boundary } = {}) { return this.read().policies.filter((item) => item.status === 'active' && (!policyArea || item.policyArea === policyArea) && (!boundary || item.boundary === boundary)); }
}

module.exports = { OUTCOMES, METRIC_DIRECTIONS, MIN_POLICY_EVIDENCE, POLICY_KIND, outcomeRecord, OutcomeStore, learningPolicyCandidate, LearningPolicyStore };
