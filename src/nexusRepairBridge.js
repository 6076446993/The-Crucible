'use strict';

const { codesInText, describeCode, remedyFor, testRequestFor, repairableByImmuneSystem } = require('./failureCodes');

function classifyNexusDiagnosis({ diagnosis, task = null }) {
  if (!diagnosis || !diagnosis.evidenceDigest || !diagnosis.summary) throw new Error('A hashed Nexus diagnosis is required.');
  const material = JSON.stringify({ findings: diagnosis.findings || [], task: task || null });
  const codes = codesInText(material);
  if (diagnosis.summary.errorCount > 0 && codes.length === 0) {
    return {
      classified: false,
      repairEligible: false,
      reason: 'Nexus diagnosis contains errors but no registered CRU classification code; Crucible will not guess a failure class from prose.',
      diagnosisDigest: diagnosis.evidenceDigest,
      codes: [],
    };
  }
  const classified = codes.map((code) => ({
    code,
    classification: describeCode(code),
    remedy: remedyFor(code),
    testRequest: testRequestFor(code),
    repairEligible: repairableByImmuneSystem(code),
  }));
  return {
    classified: codes.length > 0 || diagnosis.summary.errorCount === 0,
    repairEligible: classified.length > 0 && classified.every((entry) => entry.repairEligible),
    diagnosisDigest: diagnosis.evidenceDigest,
    codes,
    classifiedFailures: classified,
  };
}

function verifyNexusRepair({ beforeDiagnosis, afterDiagnosis, classification, test, repair }) {
  if (!beforeDiagnosis?.evidenceDigest || !afterDiagnosis?.evidenceDigest) throw new Error('Before and after hashed Nexus diagnoses are required.');
  if (!repair?.commit) return { passed: false, independent: true, reason: 'No immutable repair commit was supplied.' };
  if (!test?.passed) return { passed: false, independent: true, reason: 'The requested repair tests did not pass.' };
  if (afterDiagnosis.summary?.errorCount) return { passed: false, independent: true, reason: 'Post-repair Nexus diagnosis still contains errors.' };
  const expected = classification?.classifiedFailures || [];
  const requestedTests = expected.flatMap((entry) => entry.testRequest?.tests || []);
  return {
    passed: true,
    independent: true,
    verifier: 'The-Crucible/nexusRepairBridge',
    repairCommit: repair.commit,
    beforeDiagnosisDigest: beforeDiagnosis.evidenceDigest,
    afterDiagnosisDigest: afterDiagnosis.evidenceDigest,
    failureCodes: classification?.codes || [],
    requestedTests,
    statement: 'Crucible confirms only that the classified repair boundary passed the supplied test result and post-repair diagnosis; this does not grant governance, custody, or release authority.',
  };
}

module.exports = { classifyNexusDiagnosis, verifyNexusRepair };
