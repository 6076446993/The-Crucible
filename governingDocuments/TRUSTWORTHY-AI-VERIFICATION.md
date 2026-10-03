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