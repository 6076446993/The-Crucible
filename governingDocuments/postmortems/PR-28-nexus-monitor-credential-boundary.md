# Postmortem — PR #28 Nexus CI Monitor Credential Boundary

- **Learning Provenance ID:** `LP-PR28-CRU0006-MONITOR`
- **Pull request:** #28
- **Repository:** `jonathanblunt1214-lgtm/The-Crucible`
- **Status:** Verification pending; no learning promotion authorized.

## Symptom

The Crucible PR monitor exited with code 1 before it could produce its monitor report.

The hosted job showed that `src/nexusCheckMonitor.js` terminated during its GitHub API read phase.

## Root cause

The monitor's default credential selection preferred `CRUCIBLE_SECURITY_READ_TOKEN` for ordinary pull-request and check-run API reads.

That credential exists for the separate GitHub repository-security gate and is subject to different permission and validity requirements.

The monitor therefore allowed a security-gate credential failure to prevent ordinary monitoring from running.

## Systemic cause

Two distinct trust boundaries were represented by environment variables but were not enforced by the monitor's default dependency selection:

1. ordinary GitHub repository/PR/check observation;
2. privileged GitHub repository-security configuration inspection.

The code treated the second credential as the first credential's fallback preference.

## Corrective action

PR #28 changes `src/nexusCheckMonitor.js` so ordinary monitor reads prefer:

`GITHUB_TOKEN → CRUCIBLE_SECURITY_READ_TOKEN → GH_TOKEN`

The monitor workflow already supplies the normal workflow token through `GITHUB_TOKEN`.

A regression test now proves that an invalid security-read credential cannot displace the workflow token for ordinary monitoring.

## Preventive action

- Keep security-read credentials isolated to the repository-security gate.
- Test credential-boundary selection explicitly.
- Preserve the failure as a diagnostic record rather than treating a credential refusal as an unexplained monitor crash.
- Carry the repair through Learning Provenance and DEVLOG ingestion.
- Require independent hosted verification before promotion.

## Verification evidence

- `test/nexusCheckMonitor.test.js` contains the credential-boundary regression test.
- `test/learningProvenance.test.js` verifies the provenance lifecycle.
- `test/learningExperience.test.js` verifies DEVLOG ingestion.
- Hosted PR #28 verification must still reach a green result before this postmortem can authorize promotion.

## Lessons learned

A failing monitor is not necessarily a monitoring defect. The credential boundary was the larger condition.

The immediate symptom was useful because it exposed a systemic separation-of-authority problem.

The repair therefore fixes the boundary rather than disabling the failing security gate.

## Promotion

This postmortem is evidence for the Learning Provenance chain. It does not by itself authorize promotion into vetted learning.

Independent verification and governance remain required.
