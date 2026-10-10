# Source-bundle key manager

The Crucible now has a fail-closed automation path for the two encrypted custody
families: `raw-intake` and `oversight-vetted`. The workflow generates or rotates
32-byte keys in ephemeral runner storage, updates only non-secret fingerprints in
`source-bundle-key-registry.json`, and writes the secret values to repository
Actions secrets through a narrowly scoped GitHub App token or fine-grained PAT.
Secret values are never printed,
committed, uploaded, or shown by the Nexus dashboard.

The preferred workflow credential is the organization secret
`CRUCIBLE_KEY_MANAGER_TOKEN`, a fine-grained PAT limited to
`6076446993/The-Crucible` with repository **Secrets: Read and write** and
**Contents: Read and write**. If that secret is absent, the workflow falls
back to a narrowly-scoped GitHub App installed on
`6076446993/The-Crucible` with Actions-secrets write access and Contents write
access on `development`. The same installed App may also be used by the
read-only PR monitor: the key-manager workflow accepts either its dedicated
repository secrets `CRUCIBLE_KEY_MANAGER_APP_ID` and
`CRUCIBLE_KEY_MANAGER_PRIVATE_KEY`, or the monitor App identity
`CRUCIBLE_MONITOR_APP_CLIENT_ID` and `CRUCIBLE_MONITOR_APP_PRIVATE_KEY`.
The monitor workflow still mints a read-only token and never receives the
key-manager write path. Missing credentials fail closed. The workflow is
manual-only and development-only; it never touches `main`.

Bootstrap creates `CRUCIBLE_SOURCE_BUNDLE_KEY` and
`CRUCIBLE_VETTED_BUNDLE_KEY`. Rotation retains the currently configured values
as `*_PREVIOUS` for the governed dual-key window before the next cleanup.
Rotation cannot proceed if either current key is unavailable. Lost keys remain
unrecoverable by design; recovery requires the existing external custody/KMS
authority, not a replacement value.

Execution is additionally bound to the exact repository, the `development` ref,
and a manual `workflow_dispatch` event. The workflow retains only a 90-day
redacted lifecycle report containing key ids, fingerprints, context, and the
explicit `r8: excluded` marker. It never uploads key material or plaintext
custody.

An external KMS/OIDC backend is a deliberate capability boundary, not an
unimplemented fallback: selecting it currently fails closed until a reviewed
broker contract, audience, and provider-specific least-privilege role are
configured. The current GitHub-App path remains the only executable backend.

This manager is separate from R8. It does not admit canaries, decrypt learning
state, or alter executable-content quarantine behavior.
