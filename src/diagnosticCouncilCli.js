#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createDiagnosticCouncilEscalation } = require('./diagnosticCouncilEscalation');

async function main() {
  const reportPath = path.resolve(process.argv[2] || 'ci-diagnostic-report.json');
  const outputPath = path.resolve(process.argv[3] || 'ci-council-advisory.json');
  if (!fs.existsSync(reportPath)) throw new Error(`Diagnostic report not found: ${reportPath}`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const advisor = createDiagnosticCouncilEscalation();
  const result = await advisor.consultWhenStruggling({
    phase: 'diagnostic',
    taskId: `hosted-diagnostic-${report.runId || 'unknown'}-${report.commitSha || 'unknown'}`,
    projectId: report.projectId || `github:${report.repository || 'unknown'}`,
    boundary: `hosted-ci:${report.repository || 'unknown'}@${report.commitSha || 'unknown'}`,
    report,
    repeatedFailureCount: Number(process.env.CRUCIBLE_REPEATED_FAILURE_COUNT || 0),
    regression: process.env.CRUCIBLE_REPAIR_REGRESSION === 'true',
  });
  const envelope = {
    schemaVersion: 1,
    source: 'The-Crucible',
    reportSha256: require('node:crypto').createHash('sha256').update(JSON.stringify(report)).digest('hex'),
    advisory: result,
    authorizationGranted: false,
    proofStageSatisfied: false,
    promotionAuthorized: false,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
  console.log(result.invoked
    ? `[The Crucible] Council escalation recorded ${result.consultations.length} advisory path(s) for ${result.reasons.join(', ')}.`
    : '[The Crucible] Council escalation not required for this diagnostic.');
}

main().catch((error) => {
  console.error(`[The Crucible] Diagnostic council escalation failed closed: ${error.message}`);
  process.exitCode = 1;
});
