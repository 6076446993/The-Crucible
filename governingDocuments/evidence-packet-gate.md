# Evidence-packet gate

The Crucible now attaches a common, candidate-only evidence packet at every primary evidence boundary:

`owner intake -> discovery/retrieval -> extraction -> repair/bug fixing -> security repair -> monthly refresh -> learning worker -> pipeline diagnostics -> key custody/dashboard -> release review`.

The packet is deliberately separate from the existing state machines. It records the claim boundary, source/content hashes, reproducibility material, test results, security scans, independent verification, rollback, and an observability correlation ID. Existing strict schemas preserve compatibility while candidates carry the packet as an optional field.

## Gate contract

All packets are structurally validated when created. They remain candidate evidence until every readiness condition is true:

- deterministic reproducer and exact command are recorded;
- regression, negative, and controlled tests passed;
- secret, dependency, and static-analysis checks passed;
- an independent verifier and proof digest are recorded;
- rollback is available and described;
- a trace/correlation ID exists.

`requireReadyEvidencePacket` fails closed when any condition is missing. This helper never authorizes learning promotion or production release; the existing scientific-learning, governance, branch, custody, and release gates remain authoritative.

## Component application

The packet is emitted for owner-file intake, safe retrieval, claim extraction, repair observations, security-repair feedback, monthly refresh claims, and pipeline diagnostics. Derived organs (comparison, reasoning, controlled testing, corroboration, custody, dashboards, circulation, and release review) preserve the packet with the candidate or record the packet digest at their boundary; no component may treat a packet's presence as proof. Missing or pending fields are expected for candidate work and must remain visible to reviewers.

The contract is based on NIST SSDF/IR 8397, the NIST Bugs Framework, SLSA provenance verification, and OpenTelemetry correlation. It does not rename the pipeline, alter `main` or `Archive`, write credentials, or bypass R8.
