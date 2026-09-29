# Nexus Engineering Learning Standard

## Work philosophy

Nexus and every participating project treat failures as evidence, not conclusions.

A symptom is a clue to a deeper system condition. Fixing the immediate symptom is not considered a complete fix when a larger cause may remain.

A repair is evidence of an action. It becomes institutional knowledge only after investigation, verification, postmortem where required, and governance.

## Learning lifecycle

Observation
→ Investigation
→ Root Cause
→ Systemic Cause
→ Corrective Action
→ Preventive Action
→ Verification
→ Postmortem
→ Learning Candidate
→ Governance
→ Vetted Learning

Raw logs never become trusted learning by themselves.

## Learning Provenance ID

Every learning chain receives a permanent `Learning Provenance ID` in the form `LP-<16 hex>`.

The ID links the observation, investigation, repair, verification, postmortem, learning candidate, governance decision, and vetted-learning record.

A trusted learning record without provenance is invalid.

## Development logs

DEVLOG entries are automatically ingested as experience evidence when the learning pipeline is available.

This does not mean a DEVLOG entry is trusted learning.

The ingestion preserves:

- the original session heading;
- the session content hash;
- the repository;
- the Learning Provenance ID;
- the observation-stage lifecycle;
- the fact that promotion is not authorized.

The DEVLOG remains the human-readable engineering history. The learning store is the governed machine-readable evidence layer.

## Significant failures

A mandatory postmortem is required for:

- critical or high-impact failures;
- security incidents;
- learning-integrity failures;
- governance failures;
- failures that reveal repeated or systemic defects.

A postmortem must distinguish:

- symptom;
- root cause;
- systemic cause;
- corrective actions;
- preventive actions;
- verification evidence;
- lessons learned;
- related Provenance IDs.

## Promotion rule

A repair observation is not a learning conclusion.

A DEVLOG entry is not a learning conclusion.

A successful repair is not a learning conclusion.

Promotion to vetted learning requires verified evidence and the applicable governance decision.

## Engineering principle

The purpose of Crucible learning is not to remember that something failed.

It is to understand why it failed, determine what the system must change to prevent recurrence, verify that change, and preserve the resulting knowledge so future work can use it safely.

This standard applies to Nexus and its participating projects unless a stricter repository-specific governance rule applies.
