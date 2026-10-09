# Security/process learning pipeline

The techniques in `security-learning-techniques.json` are owner-provided
candidate evidence. `src/securityLearningCli.js queue` submits them through the
same project-bound `DurableScientificLearningStore` used by Crucible learning.
It refuses to write when durable learning custody is not configured and always
ingests records as `candidate` / `Insufficient Evidence` with promotion disabled.

The controls are already enforced in the security path: exact repository,
development branch and manual-dispatch checks; separated raw/vetted/dashboard
boundaries; redacted one-way lifecycle reports; encrypted ciphertext-only
recovery; password-protected localhost dashboard; and continuous fail-closed
verification. Learning may evaluate whether these controls improve observed
security outcomes, but it cannot activate a policy from this manifest. Any
future activation requires a declared hypothesis, controlled reproduction,
negative and regression tests, contradiction analysis, and a distinct verifier.

## Password-manager and API-key research subjects

`password-manager-human-access` and `api-key-lifecycle-management` are now
registered as candidate-only techniques and as further-research subjects. The
pipeline may study password-manager-safe human access and machine-credential
lifecycle controls, but it must not ingest credential values. A personal
password manager is for human-held dashboard credentials; workflow and custody
secrets remain in the authorized GitHub/KMS/OIDC boundary. No external password
manager is connected in this checkout, so the repository records only a
non-secret vault-item specification and never claims that a vault write occurred.

## Research mapping completed 2026-10-09

Authoritative guidance was reviewed against the candidate controls before adding
the mappings below. The sources are references, not activated policy:

- NIST SP 800-57 requires separate, protected lifecycle handling for key
  generation, storage, distribution, rotation, revocation, backup, and
  destruction. This maps to `encrypted-recovery-custody` and the key-manager
  fingerprint, dual-key rotation, and recovery-metadata tests.
- NIST SP 800-63-4 provides authentication, authenticator-lifecycle, session,
  federation, and privacy requirements. This maps to
  `application-verification-and-auth-flow` and dashboard reauthentication tests.
- OWASP's Secrets Management Cheat Sheet requires centralized storage,
  provisioning, auditing, rotation, and least-scoped CI/CD access. This maps to
  `encrypted-recovery-custody`, `least-privilege-authentication`, and redacted
  lifecycle-audit tests.
- GitHub's Secure Use, Secrets, and OIDC references require read-only default
  token permissions, exact repository/ref/audience trust conditions, rotation,
  and no unattended pull-request approval authority. This maps to
  `least-privilege-authentication` and `secure-supply-chain-development`.

The Coursera pages inspected for candidate practical material were HashiCorp
Vault Foundations and Secrets Management, Azure DevOps Security/Compliance and
Secrets Management, Protecting and Managing APIs, and Johns Hopkins
Introduction to DevSecOps. Their syllabi support hypotheses about Vault
rotation, OIDC/RBAC, API authentication, scanning, and CI/CD, but they are not
authoritative proof and have not been enrolled in or submitted as Crucible
evidence.

Required development-only checks now include wrong repository/ref/audience,
expired/revoked/rotated credentials, missing or mismatched key fingerprints,
plaintext leakage in reports and artifacts, replayed or wrong-origin sessions,
and dependency/action drift. Every failure must stop before secret or custody
mutation. No pipeline name, promotion boundary, R8 behavior, or durable
learning status changes as a result of this mapping.

## Engineering capability research mapping

Coursera syllabi were inspected for coding-assistant use, systematic debugging,
performance optimization, testing, and application-security testing. They are
candidate training material, not authoritative proof and not a license to let
an assistant mutate Crucible without review.

- Coding assistants can propose code, refactors, tests, documentation, and
  review changes. Crucible must require task routing, changed-path review,
  secret/executable scans, tests, provenance, and exact-tip verification before
  any retention or release decision.
- Debugging material emphasizes a hypothesis, deterministic reproduction,
  profiling or observability, a bounded repair, and a regression test. Crucible
  should reject fixes that suppress failures or widen unrelated scope.
- Optimization material emphasizes measured baselines, profiling, caching,
  query and architecture bottlenecks, and before/after comparison. Crucible
  should reject an optimization that regresses correctness, security, memory,
  reliability, or evidence lineage.
- Testing material emphasizes layered tests, regression, mutation, smoke,
  security, performance, concurrency, and soak cases plus precise defect
  reports. Crucible should extend claim-specific negative and regression checks
  without removing required suites or treating skipped tests as success.
- Application-security testing material emphasizes SAST/DAST, manual testing,
  vulnerability reproduction, secure debugging, and actionable remediation
  reports. Findings remain candidate-only until independent verification.

The broader Crucible review maps these practices across discovery, retrieval,
extraction, custody, workers, dashboards, and release: proposals may be fast,
but authority, provenance, bounded effects, redacted evidence, and fail-closed
verification remain mandatory at every boundary. Follow-up standards research
now includes SLSA provenance verification, OpenTelemetry traces/metrics/logs,
OWASP ASVS, and NIST SSDF. No active policy, pipeline name, R8 behavior, or
durable learning state changed.

## Additional candidate subjects submitted 2026-10-09

The following subjects are now registered in both the security-technique
manifest and the further-research register. They remain candidate-only:

- Runtime observability, incident response, and trace correlation.
- Distributed systems, concurrency, restart safety, and idempotent publication.
- Property, contract, mutation, and metamorphic testing.
- Secure software supply-chain provenance for dependencies, actions, builds, and artifacts.
- Human factors and accountable automation, applying the rule: knowledge may inform action; it may not authorize itself.
- Architecture-quality and engineering-ethics review: every architecture-affecting change declares quality attributes, stakeholders, threats, trade-offs, and rollback impact.

The immediate implementation target is runtime evidence correlation. The
existing evidence packet already spans Crucible boundaries; the next controlled
experiment must show one secret-free trace from route through verification and
rollback with exact input/output digests, actor, status, failure reason, and
rollback reference. This record is a candidate observation, not release proof.

Architecture-quality evidence is now an optional field on the shared evidence
packet. When `reviewRequired` is true, missing quality attributes, trade-offs,
threat model, stakeholders, or rollback impact makes the packet structurally
invalid. Existing packets remain compatible; this field grants no promotion or
policy authority.
## Nexus coding gateway credential boundary

The key manager now registers the Nexus coding gateway as a separate machine
identity. It is bound to `6076446993/Nexus` on
`refs/heads/Development-branch` and the audience `crucible-nexus-coding`.
The intended credential is GitHub OIDC, not a long-lived bearer token or a
new encryption-key family. `node src/sourceBundleKeyManager.js
runner-preflight` fails closed on a wrong repository, branch, audience,
missing OIDC token context, or any static runner token/key environment value.
The dashboard shows only this redacted contract status. R8 remains explicitly
excluded, and no runner credential value is stored in the registry, dashboard,
learning state, or logs.
