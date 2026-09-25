# The Crucible — Nexus Coding Architecture and Learning Plan

The Crucible is the validation, security, verification, repair/recovery, and governed-learning component of the Nexus coding architecture. It remains an independent project.

## Component relationship

Nexus
├── NVIDIA-NIM-CONSOLE
├── AI-collaboration-
└── The-Crucible
    ├── deterministic coding/security/verification gates
    ├── governed learning pipeline
    ├── Crucible-Vetted-Learning-State
    ├── Learning-Worker
    └── Vetting-and-Governance-oversite.

## Learning ownership

- Learning-Worker: extraction and candidate generation only.
- Vetting-and-Governance-oversite.: independent vetting and organism-wide governance.
- Crucible-Vetted-Learning-State: encrypted custody for oversight-approved delivery.
- Crucible learning pipeline: scientific testing, independent verification, versioning, rollback, and promotion.

## Trust-state progression

source/evidence → candidate extraction → independent oversight → vetted encrypted custody → Crucible candidate → hypothesis/controlled experiment → independent verification → verified knowledge version → active use within tested scope.

## Governing invariants

- Insufficient Evidence is non-promotable.
- Scientific proof is distinct from custody approval.
- Oversight approval is not scientific proof.
- AI council consensus is not authorization.
- Crucible cannot modify independent oversight.
- Cross-project relationships cannot redefine project identity.
- Failed and contradictory evidence is retained and classified rather than silently discarded.
- Release and promotion remain owner-authorized under existing Crucible governance.

## Implementation plan

1. Keep the existing scientific-learning policy and release plan authoritative for learning proof.
2. Keep independent oversight outside Crucible runtime custody.
3. Keep worker and vetted-state repositories separately permissioned.
4. Maintain explicit cross-repository integration checks.
5. Prove an end-to-end learning cycle with real evidence before declaring learning operational.
6. Prove a prompt-based coding cycle through Nexus → AI Collaboration → Crucible.
7. Record exact commits, hashes, gate results, and unresolved blockers.