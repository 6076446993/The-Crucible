# Failure-Code Governance

## Purpose

PR #28 treats a CRU code as the identity of a **failure class**, not the identity of an individual occurrence.

## Canonical rules

1. **One distinct failure class has one canonical CRU code.**
2. A repeated occurrence of an established failure class reuses the existing CRU code.
3. A repair, verification run, repository, operating system, workflow run, symptom, or individual occurrence does not create another CRU code merely because it differs in context.
4. An occurrence that has not yet been classified has failureCode: null and failureCodeStatus: pending-classification. It is never assigned CRU-0000 as a catch-all.
5. A valid but unregistered supplied code may be retained as pending-registration; it is not promoted or treated as an established diagnosis until the registry is reconciled.
6. Once an occurrence is classified as a duplicate, it records the existing canonical failure identity and reuses that failure's CRU code.
7. The same canonicalFailureId must never resolve to two different CRU codes. Conflicting assignments fail closed.
8. Every occurrence keeps its own evidence, CI identity, repair history, verification, and provenance even when it is classified as a duplicate.

## Historical audit for PR #28

The complete current DEVLOG.md and Devlog-Pruned archive were reviewed for duplicate failures, prior errors, and repairs.

Findings:

- No documented case was found in those logs where one underlying failure class was assigned multiple CRU codes.
- The repeated historical entry about a duplicate push trigger concerns workflow-trigger duplication, not duplicate CRU failure codes.
- A prior known-bug ledger defect is directly relevant: one real failing test had been represented as four failed categories and all 102 selected tests. The repair changed attribution to the actual failing test and category instead of multiplying the diagnosis.
- The repair-evidence system already deduplicates the same content-addressed repair attempt, so the same repair is not recorded as multiple observations. PR #28 now applies the same discipline to failure classification.
- Historical CRU codes such as CRU-0006 and CRU-0045 recur across multiple runs when the same failure class recurs. That is consistent with the canonical rule; recurrence is not a reason to mint another code.
- CRU-0000 is retained only as historical registry data and is not a CRU classification. Durable failure records use null until classification is established.

## Required custody chain

Occurrence → Evidence → Investigation → Canonical Failure Classification → Repair → Verification → Learning Candidate → Governance → Vetted Learning

A duplicate classification changes the identity reference; it does not erase the occurrence or its evidence.

## Enforcement

src/failureRecord.js provides:

- pending-classification for genuinely uncoded occurrences.
- classifyFailureRecord() for attaching a registered canonical CRU code and optional duplicate relationship.
- assertCanonicalFailureCodeAssignments() to reject conflicting CRU codes for the same canonical failure.

The rule is verified by test/failureRecord.test.js and remains subject to the full Crucible Section 2 gate.

## CRU boundary — mandatory

CRU codes classify **actual bug/error classes only**.

A CRU code MUST NOT classify:
- a repair or repair-learning observation;
- a learning state, learning blockage, or learning-corpus condition;
- a governance state, policy decision, exception, or coordination state;
- a monitoring/observation state or missing monitor evidence;
- an authorization or routing state;
- a lifecycle state;
- missing evidence or a missing provenance record;
- schema/validation mechanics merely because validation rejected a record;
- an uncoded/pending occurrence.

For an observed failure whose underlying bug/error class is not yet known, the occurrence remains `failureCode: null` with `failureCodeStatus: pending-classification`.

### Historical CRU migration

The pre-PR-28 registry contained CRU codes that described the non-CRU states above. Those identifiers are now historical/operational identifiers only. They are not returned by `describeCode()`, are not accepted by `classifyFailureRecord()`, are not returned by `failureCode()`, and cannot be emitted as a CRU classification. When legacy call sites still invoke the compatibility `crucibleError()` entry point with one of those identifiers, the emitted error is an `OPS-####` operational error with `legacyCrucibleCode` retained solely for migration traceability.

The active CRU classification set is limited to actual defects/errors: repository integrity defects, required security-configuration defects, invalid workflow configuration, privacy exposure, unsafe generated artifacts, verification-command failures/timeouts/start failures/missing outputs, invalid workflow context/diagnostic-step defects, credential configuration/exposure defects, AI-provider transport/configuration failures, PDF extraction failures, and admitted-source retrieval failures.

A historical occurrence carrying a retired CRU identifier is not silently reclassified as a new CRU class. Its original history remains auditable while new occurrences use the actual bug/error classification or remain pending.

### One-code-per-class rule remains in force

The active CRU set still obeys the canonical identity rule: one distinct bug/error class has one canonical CRU code; repeated occurrences reuse it; repair, verification, run, symptom, or learning evidence never creates another code.

## CRU-linked repair learning and prevention

Repair, repair-learning, and prevention are downstream relationships of a CRU classification; they never create a CRU classification themselves.

A verified repair observation MAY carry its active `failureCode` into learning provenance. The linked value MUST resolve through the active CRU classification registry. Retired process-state identifiers and unknown `CRU-####` strings are rejected rather than admitted as repair-learning classification.

The governed progression is:

`failure occurrence -> CRU classification -> repair attempt -> independently verified repair evidence -> learning custody -> controlled proof -> independent verification -> vetted knowledge -> prevention rule -> pre-execution enforcement`.

A successful repair is never sufficient to create a prevention rule. Repair observations remain non-promotable evidence. Prevention is permitted only from an active vetted knowledge version whose candidate identity, proof hash, and experimental boundary match the prevention mapping.

A prevention rule MUST:
- reference an active CRU bug/error class;
- reference the exact active vetted knowledge version and candidate;
- bind to the proof hash that earned promotion;
- stay inside the experimentally verified boundary;
- state the precursor paths/conditions it covers;
- state whether it blocks, requires a check, or warns;
- cease enforcement when its underlying knowledge version is rolled back, superseded, quarantined, or otherwise inactive.

The preferred outcome is prevention before occurrence. When a proven precursor is encountered, The Crucible should run or require the learned preventive check before execution/merge. A prevented precursor is prevention telemetry, not a new failure occurrence and not a new CRU code.
