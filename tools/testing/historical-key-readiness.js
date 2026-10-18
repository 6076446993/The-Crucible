'use strict';
// Read-only historical identity audit. NEVER treats metadata as decryption proof.
const fs = require('node:fs');
const path = require('node:path');
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;

function validateEntry(entry, place) {
  if (entry === null) return;
  if (!entry || typeof entry !== 'object' || !HEX64.test(entry.sha256) ||
      typeof entry.id !== 'string' || entry.id.length === 0) throw new Error(`INVALID_KEY_METADATA:${place}`);
}
function inspect(history) {
  if (!history || history.schemaVersion !== 1 || !Array.isArray(history.revisions) || !history.revisions.length)
    throw new Error('INVALID_REGISTRY_HISTORY');
  let lastMs = -Infinity;
  const seenCommits = new Set();
  const families = { raw: new Map(), vetted: new Map() };
  const references = [
    ['raw', 'rawCurrent', 'current'], ['raw', 'rawPrevious', 'previous'],
    ['vetted', 'vettedCurrent', 'current'], ['vetted', 'vettedPrevious', 'previous'],
  ];
  for (const revision of history.revisions) {
    const ms = Date.parse(revision.timestamp);
    if (!HEX40.test(revision.sha) || seenCommits.has(revision.sha) || !Number.isFinite(ms) || ms < lastMs)
      throw new Error('INVALID_REGISTRY_CHRONOLOGY');
    seenCommits.add(revision.sha); lastMs = ms;
    for (const [family, key, role] of references) {
      const entry = revision[key];
      validateEntry(entry, `${revision.sha}/${key}`);
      if (!entry) continue;
      const prior = families[family].get(entry.sha256);
      if (prior && prior.ids.every(v => v !== entry.id)) prior.ids.push(entry.id);
      if (prior) prior.roles.push({role, commit:revision.sha});
      else families[family].set(entry.sha256, {
        sha256:entry.sha256,
        ids:[entry.id],
        firstSeenCommit:revision.sha,
        roles:[{role, commit:revision.sha}]
      });
    }
  }
  const last = history.revisions.at(-1);
  const active = new Set([last.rawCurrent?.sha256,last.rawPrevious?.sha256].filter(Boolean));
  const raw = [...families.raw.values()].map(x=>({...x, referencedInCurrentRegistry:active.has(x.sha256), identityHasPlaceholder:x.ids.includes('REQUIRED_OWNER_KEY_ID')}));
  const vetted = [...families.vetted.values()];
  const findings=[];
  if (raw.some(x=>!x.referencedInCurrentRegistry)) findings.push('HISTORICAL_RAW_FINGERPRINT_ABSENT_FROM_CURRENT_REGISTRY');
  if (raw.some(x=>x.identityHasPlaceholder)) findings.push('HISTORICAL_RAW_KEY_ID_UNREGISTERED');
  if (!vetted.length || !last.vettedCurrent) findings.push('VETTED_KEY_METADATA_UNREGISTERED');
  findings.push('LIVE_SECRET_POSSESSION_NOT_VERIFIED');
  findings.push('HISTORICAL_AES_GCM_DECRYPTION_NOT_VERIFIED');
  findings.push('INDEPENDENT_ALL_HISTORY_COLD_RESTORE_NOT_VERIFIED');
  return {
    schemaVersion:1,
    sourceRepository:history.sourceRepository,
    inspectedHead:history.inspectedHead,
    revisionsInspected:history.revisions.length,
    knownRawKeyFingerprints:raw,
    knownVettedKeyFingerprints:vetted,
    metadataFindings:findings,
    historicalKeyMaterialVerified:false,
    independentRecoveryAccepted:false,
    readiness:'BLOCKED',
    disclaimer:'Key SHA-256 identifiers are not cryptographic proof of key possession or recoverability. This diagnostic never reads secrets or opens ciphertext.'
  };
}
if (require.main === module) {
  try {
    const file = process.argv[2] || path.join(__dirname,'..','..','fixtures','historical-key-registry-history.json');
    const result = inspect(JSON.parse(fs.readFileSync(file,'utf8')));
    console.log(JSON.stringify(result,null,2));
    process.exitCode = 2; // Intentional incomplete-proof marker, not a test failure.
  } catch (e) {
    console.error('HISTORICAL_KEY_AUDIT_ERROR:'+e.message);
    process.exitCode = 1;
  }
}
module.exports={inspect};
