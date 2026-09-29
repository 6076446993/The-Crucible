'use strict';

const { describeCode } = require('./failureCodes');

const ACTIONS = Object.freeze(['block', 'require-check', 'warn']);

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text.`);
  return value.trim();
}

function preventionRule(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('prevention rule must be an object.');
  const failureCode = text(input.failureCode, 'failureCode');
  if (!describeCode(failureCode)) throw new Error(`${failureCode} is not an active CRU bug/error classification.`);
  const knowledgeVersion = input.knowledgeVersion;
  if (!Number.isSafeInteger(knowledgeVersion) || knowledgeVersion < 1) throw new Error('knowledgeVersion must be a positive integer.');
  const action = input.action || 'block';
  if (!ACTIONS.includes(action)) throw new Error(`prevention action must be one of: ${ACTIONS.join(', ')}.`);
  if (!Array.isArray(input.paths) || !input.paths.length || input.paths.some((p) => typeof p !== 'string' || !p.trim())) throw new Error('prevention paths must be a non-empty text array.');
  return Object.freeze({
    schemaVersion: 1,
    id: input.id || `prevent-${failureCode}-v${knowledgeVersion}`,
    failureCode,
    canonicalFailureId: input.canonicalFailureId ? text(input.canonicalFailureId, 'canonicalFailureId') : null,
    knowledgeVersion,
    knowledgeCandidateId: text(input.knowledgeCandidateId, 'knowledgeCandidateId'),
    proofSha256: text(input.proofSha256, 'proofSha256'),
    boundary: text(input.boundary, 'boundary'),
    action,
    paths: [...new Set(input.paths.map((p) => p.trim()))].sort(),
    requiredCheck: input.requiredCheck ? text(input.requiredCheck, 'requiredCheck') : null,
    rationale: text(input.rationale, 'rationale'),
    enabled: input.enabled !== false,
  });
}

function mappingsForVettedKnowledge({ knowledge, candidateRecords, declarations }) {
  if (!Array.isArray(knowledge) || !Array.isArray(candidateRecords) || !Array.isArray(declarations)) throw new Error('knowledge, candidateRecords, and declarations must be arrays.');
  const candidates = new Map(candidateRecords.map((record) => [record?.candidate?.id, record]));
  return knowledge.filter((item) => item?.status === 'active').map((item) => {
    const record = candidates.get(item.candidateId);
    if (!record || record.state !== 'verified') throw new Error(`Active knowledge ${item.version} has no verified candidate record.`);
    const failureCode = record.candidate?.provenance?.failureCode;
    if (!failureCode || !describeCode(failureCode)) throw new Error(`Vetted prevention candidate ${item.candidateId} has no active CRU classification.`);
    const declaration = declarations.find((entry) => entry.failureCode === failureCode);
    if (!declaration) throw new Error(`No governed prevention declaration exists for ${failureCode}.`);
    const declaredBoundary = [...new Set(declaration.precursorPaths || [])].sort().join(',');
    if (item.boundary !== declaredBoundary || record.candidate.claimBoundary !== declaredBoundary) throw new Error('Vetted knowledge boundary does not match the governed prevention declaration.');
    return {
      failureCode,
      knowledgeVersion: item.version,
      knowledgeCandidateId: item.candidateId,
      proofSha256: item.proofSha256,
      boundary: item.boundary,
      action: declaration.action || 'require-check',
      paths: [...declaration.precursorPaths],
      requiredCheck: declaration.requiredCheck,
      rationale: declaration.rationale,
    };
  });
}

function rulesFromVettedKnowledge({ knowledge, mappings }) {
  if (!Array.isArray(knowledge)) throw new Error('knowledge must be an array.');
  if (!Array.isArray(mappings)) throw new Error('mappings must be an array.');
  const active = new Map(knowledge.filter((k) => k && k.status === 'active').map((k) => [k.version, k]));
  const rules = [];
  for (const mapping of mappings) {
    const version = active.get(mapping.knowledgeVersion);
    if (!version) continue;
    if (version.candidateId !== mapping.knowledgeCandidateId) throw new Error('Prevention mapping candidate does not match vetted knowledge.');
    if (version.proofSha256 !== mapping.proofSha256) throw new Error('Prevention mapping proof does not match vetted knowledge.');
    if (version.boundary !== mapping.boundary) throw new Error('Prevention mapping exceeds its vetted knowledge boundary.');
    rules.push(preventionRule(mapping));
  }
  return rules;
}

function loadVettedPrevention({ root, projectId, mappings, completedChecks = [] }) {
  const { DurableScientificLearningStore } = require('./scientificLearning');
  const store = new DurableScientificLearningStore({ root, projectId });
  return { knowledge: store.activeKnowledge(), mappings, completedChecks };
}

function pathMatches(rulePath, changedPath) {
  if (rulePath.endsWith('/')) return changedPath === rulePath.slice(0, -1) || changedPath.startsWith(rulePath);
  return changedPath === rulePath;
}

function evaluatePrevention({ rules, changedPaths, completedChecks = [], outcomeRecorder = null, projectId = null, observedAt = () => new Date().toISOString() }) {
  if (!Array.isArray(rules) || !Array.isArray(changedPaths) || !Array.isArray(completedChecks)) throw new Error('rules, changedPaths, and completedChecks must be arrays.');
  const completed = new Set(completedChecks);
  const findings = [];
  for (const raw of rules) {
    const rule = preventionRule(raw);
    if (!rule.enabled) continue;
    const matchedPaths = changedPaths.filter((p) => rule.paths.some((rp) => pathMatches(rp, p)));
    if (!matchedPaths.length) continue;
    if (rule.requiredCheck && completed.has(rule.requiredCheck)) continue;
    const finding = {
      type: 'learned-prevention',
      failureCode: rule.failureCode,
      canonicalFailureId: rule.canonicalFailureId,
      preventionRuleId: rule.id,
      knowledgeVersion: rule.knowledgeVersion,
      action: rule.action,
      paths: matchedPaths,
      requiredCheck: rule.requiredCheck,
      detail: rule.requiredCheck
        ? `Vetted learning for ${rule.failureCode} requires ${rule.requiredCheck} before this change proceeds.`
        : `Vetted learning for ${rule.failureCode} identified this change boundary as a proven precursor condition.`,
    };
    findings.push(finding);
    if (outcomeRecorder) {
      if (!projectId) throw new Error('projectId is required when prevention outcome recording is enabled.');
      const outcomeAt = observedAt();
      outcomeRecorder.record({
        projectId,
        outcomeId: `prevention-trigger:${rule.id}:${rule.knowledgeVersion}:${matchedPaths.join(',')}:${outcomeAt}`,
        lifecycle: 'prevention',
        outcome: 'triggered',
        failureCode: rule.failureCode,
        canonicalFailureId: rule.canonicalFailureId,
        preventionRuleId: rule.id,
        knowledgeVersion: rule.knowledgeVersion,
        changedPaths: matchedPaths,
        completedChecks,
        expected: rule.requiredCheck ? `${rule.requiredCheck} completes before execution` : 'proven precursor is blocked before execution',
        actual: rule.requiredCheck ? `preflight identified requirement for ${rule.requiredCheck}` : 'preflight identified the proven precursor',
        observedAt: outcomeAt,
      });
    }
  }
  return findings;
}

function recordOutcome(input, finding, outcome, actual) {
  if (!input.outcomeRecorder) return;
  if (!input.projectId) throw new Error('projectId is required when prevention outcome recording is enabled.');
  const at = (input.observedAt || (() => new Date().toISOString()))();
  input.outcomeRecorder.record({
    projectId:input.projectId, outcomeId:`prevention-${outcome}:${finding.preventionRuleId}:${finding.knowledgeVersion}:${finding.paths.join(',')}:${at}`,
    lifecycle:'prevention', outcome, failureCode:finding.failureCode, canonicalFailureId:finding.canonicalFailureId,
    preventionRuleId:finding.preventionRuleId, knowledgeVersion:finding.knowledgeVersion, changedPaths:finding.paths,
    completedChecks:input.completedChecks || [], expected:finding.detail, actual, observedAt:at,
  });
}

function enforcePrevention(input) {
  const evaluationInput = { ...input, outcomeRecorder:null };
  const findings = evaluatePrevention(evaluationInput);
  const blocking = findings.filter((f) => f.action === 'block' || f.action === 'require-check');
  if (input.bypass === true) {
    for (const finding of blocking) recordOutcome(input, finding, 'bypassed', text(input.bypassReason, 'bypassReason'));
    return { findings, blocked:false, bypassed:blocking.length > 0 };
  }
  if (blocking.length) {
    for (const finding of blocking) recordOutcome(input, finding, 'prevented', 'enforcement blocked execution before the proven precursor could proceed');
    const error = new Error(`Learned prevention blocked ${blocking.length} proven precursor condition(s):\n${blocking.map((f) => `- ${f.failureCode}: ${f.detail}`).join('\n')}`);
    error.preventionFindings = blocking;
    throw error;
  }
  return { findings, blocked: false };
}

function recordPreventionAdjudication({ outcomeRecorder, projectId, finding, outcome, actual, observedAt = () => new Date().toISOString() }) {
  if (!['false-positive','missed','failed-prevention'].includes(outcome)) throw new Error('Prevention adjudication must be false-positive, missed, or failed-prevention.');
  text(actual, 'actual');
  recordOutcome({ outcomeRecorder, projectId, observedAt, completedChecks:[] }, finding, outcome, actual);
  return outcome;
}

module.exports = { ACTIONS, preventionRule, mappingsForVettedKnowledge, rulesFromVettedKnowledge, loadVettedPrevention, evaluatePrevention, enforcePrevention, recordPreventionAdjudication };
