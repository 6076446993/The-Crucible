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

function pathMatches(rulePath, changedPath) {
  if (rulePath.endsWith('/')) return changedPath === rulePath.slice(0, -1) || changedPath.startsWith(rulePath);
  return changedPath === rulePath;
}

function evaluatePrevention({ rules, changedPaths, completedChecks = [] }) {
  if (!Array.isArray(rules) || !Array.isArray(changedPaths) || !Array.isArray(completedChecks)) throw new Error('rules, changedPaths, and completedChecks must be arrays.');
  const completed = new Set(completedChecks);
  const findings = [];
  for (const raw of rules) {
    const rule = preventionRule(raw);
    if (!rule.enabled) continue;
    const matchedPaths = changedPaths.filter((p) => rule.paths.some((rp) => pathMatches(rp, p)));
    if (!matchedPaths.length) continue;
    if (rule.requiredCheck && completed.has(rule.requiredCheck)) continue;
    findings.push({
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
    });
  }
  return findings;
}

function enforcePrevention(input) {
  const findings = evaluatePrevention(input);
  const blocking = findings.filter((f) => f.action === 'block' || f.action === 'require-check');
  if (blocking.length) {
    const error = new Error(`Learned prevention blocked ${blocking.length} proven precursor condition(s):\n${blocking.map((f) => `- ${f.failureCode}: ${f.detail}`).join('\n')}`);
    error.preventionFindings = blocking;
    throw error;
  }
  return { findings, blocked: false };
}

module.exports = { ACTIONS, preventionRule, rulesFromVettedKnowledge, evaluatePrevention, enforcePrevention };
