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
