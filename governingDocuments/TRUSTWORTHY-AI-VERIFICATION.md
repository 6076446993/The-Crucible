# Trustworthy AI Verification Responsibilities

This repository implements the Nexus Trustworthy AI Governance Contract only within The Crucible's existing verification authority.

## Required controls
- Preserve evidence, provenance, source/version references, uncertainty, conflicts, and failed checks used in verification.
- Make material verification outcomes reproducible or challengeable through retained evidence and decision lineage where feasible.
- Keep AI consensus, governance approval, custody, and extraction distinct from verification.
- Apply robustness, security, privacy, and failure controls to AI-derived claims before authoritative verification.
- Fail closed when mandatory evidence, provenance, authorization, identity, or version binding is absent.
- Preserve STOP/rejection/failure state and do not rewrite unsuccessful verification as success.
- Repair may correct a defect but must preserve the original failure evidence and correction lineage.
- Learning from repair or verification failures must pass existing learning/governance/custody boundaries before becoming trusted capability.
- Support safe supersession, rollback, or decommissioning of verified capability when later evidence invalidates it.

This document does not transfer governance authority, custody authority, extraction authority, or repository ownership to The Crucible.

## Self-repair regression verification
- Treat evidence that an automated repair introduced or materially contributed to a new failure as a first-class repair-regression candidate, not as an unrelated later failure.
- Preserve the attempted repair commit, pre-repair head, affected component, failed run/check references, bounded failure evidence, corrective commit, successful verification evidence, prevention lesson, and complete lineage.
- Classify causality only from evidence. Temporal sequence alone is insufficient to declare that a repair caused a failure.
- A confirmed repair regression is negative learning evidence. Submit it through Crucible's existing experience-observation / scientific-learning path; it cannot directly become verified knowledge or skip controlled and independent verification.
- A successful correction never erases the original repair regression. Remediation extends the lineage.
- When evaluating a later repair strategy, applicable prior confirmed repair regressions are regression context. Repeating a known harmful strategy requires new evidence addressing the recorded failure mode.
- Nexus may define the cross-system RepairRegressionRecord contract, but The Crucible retains failure-classification and verification authority. This does not give Nexus, Learning Worker, custody, oversight, or an interface the power to self-declare a regression verified.
