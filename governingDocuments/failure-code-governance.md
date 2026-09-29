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
- CRU-0000 remains a diagnostic-coverage concept in the throw-site failure-code registry, but it is **not** a durable failure-occurrence code. Durable failure records use null until classification is established.

## Required custody chain

Occurrence → Evidence → Investigation → Canonical Failure Classification → Repair → Verification → Learning Candidate → Governance → Vetted Learning

A duplicate classification changes the identity reference; it does not erase the occurrence or its evidence.

## Enforcement

src/failureRecord.js provides:

- pending-classification for genuinely uncoded occurrences.
- classifyFailureRecord() for attaching a registered canonical CRU code and optional duplicate relationship.
- assertCanonicalFailureCodeAssignments() to reject conflicting CRU codes for the same canonical failure.

The rule is verified by test/failureRecord.test.js and remains subject to the full Crucible Section 2 gate.
