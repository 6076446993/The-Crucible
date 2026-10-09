# Source-bundle key manager

The Crucible now has a fail-closed automation path for the two encrypted custody
families: `raw-intake` and `oversight-vetted`. The workflow generates or rotates
32-byte keys in ephemeral runner storage, updates only non-secret fingerprints in
`source-bundle-key-registry.json`, and writes the secret values to repository
Actions secrets through a GitHub App token. Secret values are never printed,
committed, uploaded, or shown by the Nexus dashboard.

The workflow requires a narrowly-scoped GitHub App installed on
`6076446993/The-Crucible` with Actions-secrets write access and Contents write
access on `development`. Its bootstrap credentials are themselves stored as
repository secrets named `CRUCIBLE_KEY_MANAGER_APP_ID` and
`CRUCIBLE_KEY_MANAGER_PRIVATE_KEY`. Missing credentials fail closed. The
workflow is manual-only and development-only; it never touches `main`.

Bootstrap creates `CRUCIBLE_SOURCE_BUNDLE_KEY` and
`CRUCIBLE_VETTED_BUNDLE_KEY`. Rotation retains the currently configured values
as `*_PREVIOUS` for the governed dual-key window before the next cleanup.
Rotation cannot proceed if either current key is unavailable. Lost keys remain
unrecoverable by design; recovery requires the existing external custody/KMS
authority, not a replacement value.

This manager is separate from R8. It does not admit canaries, decrypt learning
state, or alter executable-content quarantine behavior.
