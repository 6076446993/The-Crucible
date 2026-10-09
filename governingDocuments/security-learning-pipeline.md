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
