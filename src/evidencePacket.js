'use strict';

const crypto = require('node:crypto');

const sha256 = (value) => crypto.createHash('sha256')
  .update(typeof value === 'string' ? value : JSON.stringify(value))
  .digest('hex');

const REQUIRED = Object.freeze([
  'projectId', 'component', 'claim', 'boundary', 'provenance', 'reproducibility',
  'tests', 'security', 'independentVerification', 'rollback', 'observability',
]);

const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
};

const digest = (value, label) => {
  if (!/^[a-f0-9]{64}$/.test(String(value || ''))) throw new Error(`${label} must be a SHA-256 digest.`);
  return String(value);
};

function createEvidencePacket({
  id = null,
  projectId,
  component,
  claim,
  boundary,
  provenance = {},
  reproducibility = {},
  tests = {},
  security = {},
  independentVerification = {},
  rollback = {},
  observability = {},
  architecture = {},
  state = 'candidate',
  createdAt = new Date().toISOString(),
}) {
  const packet = {
    schemaVersion: 1,
    id: id || `evidence-${sha256({ projectId, component, claim, boundary, createdAt }).slice(0, 32)}`,
    projectId: text(projectId, 'evidencePacket.projectId'),
    component: text(component, 'evidencePacket.component'),
    claim: text(claim, 'evidencePacket.claim'),
    boundary: text(boundary, 'evidencePacket.boundary'),
    state: text(state, 'evidencePacket.state'),
    provenance: {
      sourceIds: Array.isArray(provenance.sourceIds) ? [...new Set(provenance.sourceIds.map(String))] : [],
      contentSha256: provenance.contentSha256 ? digest(provenance.contentSha256, 'evidencePacket.provenance.contentSha256') : null,
      baseSha256: provenance.baseSha256 ? digest(provenance.baseSha256, 'evidencePacket.provenance.baseSha256') : null,
      actorId: provenance.actorId ? text(provenance.actorId, 'evidencePacket.provenance.actorId') : null,
    },
    reproducibility: {
      reproducerSha256: reproducibility.reproducerSha256 ? digest(reproducibility.reproducerSha256, 'evidencePacket.reproducibility.reproducerSha256') : null,
      command: reproducibility.command ? text(reproducibility.command, 'evidencePacket.reproducibility.command') : null,
      deterministic: reproducibility.deterministic === true,
    },
    tests: {
      regression: tests.regression === true,
      negative: tests.negative === true,
      controlled: tests.controlled === true,
      details: Array.isArray(tests.details) ? tests.details.map(String) : [],
    },
    security: {
      secretScan: security.secretScan === true,
      dependencyScan: security.dependencyScan === true,
      staticAnalysis: security.staticAnalysis === true,
      details: Array.isArray(security.details) ? security.details.map(String) : [],
    },
    independentVerification: {
      status: independentVerification.status || 'pending',
      verifierId: independentVerification.verifierId ? text(independentVerification.verifierId, 'evidencePacket.independentVerification.verifierId') : null,
      proofSha256: independentVerification.proofSha256 ? digest(independentVerification.proofSha256, 'evidencePacket.independentVerification.proofSha256') : null,
    },
    rollback: {
      available: rollback.available === true,
      strategy: rollback.strategy ? text(rollback.strategy, 'evidencePacket.rollback.strategy') : null,
      tokenSha256: rollback.tokenSha256 ? digest(rollback.tokenSha256, 'evidencePacket.rollback.tokenSha256') : null,
    },
    observability: {
      traceId: observability.traceId ? text(observability.traceId, 'evidencePacket.observability.traceId') : null,
      eventCount: Number.isSafeInteger(observability.eventCount) && observability.eventCount >= 0 ? observability.eventCount : 0,
    },
    architecture: {
      reviewRequired: architecture.reviewRequired === true,
      qualityAttributes: Array.isArray(architecture.qualityAttributes) ? [...new Set(architecture.qualityAttributes.map(String).filter(Boolean))] : [],
      tradeoffs: Array.isArray(architecture.tradeoffs) ? architecture.tradeoffs.map(String).filter(Boolean) : [],
      threatModel: Array.isArray(architecture.threatModel) ? architecture.threatModel.map(String).filter(Boolean) : [],
      stakeholders: Array.isArray(architecture.stakeholders) ? [...new Set(architecture.stakeholders.map(String).filter(Boolean))] : [],
      rollbackImpact: architecture.rollbackImpact ? text(architecture.rollbackImpact, 'evidencePacket.architecture.rollbackImpact') : null,
    },
    createdAt: text(createdAt, 'evidencePacket.createdAt'),
  };
  return Object.freeze(packet);
}

function validateEvidencePacket(packet) {
  const missing = [];
  const errors = [];
  if (!packet || packet.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  for (const key of REQUIRED) if (!packet || packet[key] === undefined || packet[key] === null) missing.push(key);
  if (packet?.provenance?.contentSha256 && !/^[a-f0-9]{64}$/.test(packet.provenance.contentSha256)) errors.push('provenance.contentSha256 is invalid.');
  if (packet?.architecture?.reviewRequired === true) {
    if (!packet.architecture.qualityAttributes?.length) errors.push('architecture.qualityAttributes is required when reviewRequired is true.');
    if (!packet.architecture.threatModel?.length) errors.push('architecture.threatModel is required when reviewRequired is true.');
    if (!packet.architecture.tradeoffs?.length) errors.push('architecture.tradeoffs is required when reviewRequired is true.');
    if (!packet.architecture.rollbackImpact) errors.push('architecture.rollbackImpact is required when reviewRequired is true.');
  }
  const ready = missing.length === 0 && errors.length === 0 &&
    packet.reproducibility.deterministic === true &&
    packet.tests.regression === true && packet.tests.negative === true && packet.tests.controlled === true &&
    packet.security.secretScan === true && packet.security.dependencyScan === true && packet.security.staticAnalysis === true &&
    packet.independentVerification.status === 'passed' && Boolean(packet.independentVerification.verifierId) &&
    packet.rollback.available === true && Boolean(packet.rollback.strategy) && Boolean(packet.observability.traceId) &&
    (packet.architecture?.reviewRequired !== true || (packet.architecture.qualityAttributes.length > 0 && packet.architecture.threatModel.length > 0 && packet.architecture.tradeoffs.length > 0 && Boolean(packet.architecture.rollbackImpact)));
  return { valid: missing.length === 0 && errors.length === 0, ready, missing, errors, packetSha256: sha256(packet) };
}

function requireReadyEvidencePacket(packet) {
  const result = validateEvidencePacket(packet);
  if (!result.valid) throw new Error(`Evidence packet is structurally invalid: ${[...result.missing, ...result.errors].join(' ')}`);
  if (!result.ready) throw new Error('Evidence packet is not promotion-ready: reproducibility, tests, security, independent verification, rollback, and observability are all required.');
  return packet;
}

function candidatePacket(options) {
  return createEvidencePacket(options);
}

function attachEvidencePacket(value, packet) {
  if (!value || typeof value !== 'object') throw new Error('Evidence packet attachment requires an object.');
  Object.defineProperty(value, 'evidencePacket', { value: packet, enumerable: false, writable: false, configurable: false });
  return value;
}

module.exports = { sha256, createEvidencePacket, candidatePacket, attachEvidencePacket, validateEvidencePacket, requireReadyEvidencePacket };
