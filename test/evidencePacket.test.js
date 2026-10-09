'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEvidencePacket, validateEvidencePacket, requireReadyEvidencePacket } = require('../src/evidencePacket');

const digest = 'a'.repeat(64);

test('every candidate packet is structurally complete but remains non-ready until all gates pass', () => {
  const packet = createEvidencePacket({ projectId:'p', component:'retrieval', claim:'bounded claim', boundary:'one source', provenance:{contentSha256:digest}, observability:{traceId:'trace-1'} });
  const result = validateEvidencePacket(packet);
  assert.equal(result.valid, true);
  assert.equal(result.ready, false);
  assert.equal(packet.state, 'candidate');
});

test('promotion readiness requires every evidence gate', () => {
  const packet = createEvidencePacket({
    projectId:'p', component:'repair', claim:'bounded claim', boundary:'one file',
    provenance:{contentSha256:digest, baseSha256:digest, sourceIds:['source-1'], actorId:'actor-1'},
    reproducibility:{reproducerSha256:digest, command:'npm test -- repair', deterministic:true},
    tests:{regression:true, negative:true, controlled:true},
    security:{secretScan:true, dependencyScan:true, staticAnalysis:true},
    independentVerification:{status:'passed', verifierId:'verifier-2', proofSha256:digest},
    rollback:{available:true, strategy:'restore prior content', tokenSha256:digest},
    observability:{traceId:'trace-1', eventCount:3},
  });
  assert.equal(validateEvidencePacket(packet).ready, true);
  assert.equal(requireReadyEvidencePacket(packet), packet);
});

test('ready assertion fails closed when one gate is missing', () => {
  const packet = createEvidencePacket({ projectId:'p', component:'worker', claim:'bounded claim', boundary:'one window', observability:{traceId:'trace-1'} });
  assert.throws(() => requireReadyEvidencePacket(packet), /not promotion-ready/);
});
