# Owner-file transport and authenticated intake

Base repository: 6076446993/The-Crucible, development f6702be30d24efad1c408338a22a05ae4ec1ee89.

The repair adds an encrypted owner-file request, private raw-state staging, manual hosted import, complete source/hash validation, canonical legacy project identity preservation, exact queue-wide source deduplication, supporting-catalog custody without catalog extraction, separate snapshot mutation, compare-and-swap ciphertext publication, rollback and honest receipt statuses. It uses the existing raw encryption key and existing state deploy identity. It generates no replacement production credentials or queues and performs no extraction, verification or promotion.

## Verified

- 6/6 owner-transport tests passed, zero skipped: authenticated roundtrip, candidate preservation, duplicate-only retry, wrong key/hash/project/tampering refusal, path-traversal refusal, live-lock and in-place refusal, snapshot archive encryption/publication/restore and rollback lease, immutable ciphertext request staging.
- Disposable end-to-end test used all five actual attached PDFs and both original catalog files: 5 imports, 2 supporting artifacts; repeat 0 new imports / 5 duplicates. No live queue or production credentials involved; all disposable plaintext/ciphertext destroyed.
- All five PDFs accepted by the existing preflight validator with expected page counts 12, 52, 259, 9 and 11.
- Workflow YAML, exact action pins, manual-only trigger and bash syntax validated.
- Existing owner intake/custody/durable-lock tests: 30/30 passed before this proposal.
- Hosted execution and independent review remain unperformed. Local passes are not live proof or an independent verifier's approval.

## Integration and boundaries

The implementation uses the existing intake, source-bundle encryption and raw-custody publisher. Owner authorization on 2026-10-08 permits takeover of the prior repair and narrow deployment of this workflow through development, release and main. The previous claim was already released; its plan is preserved in AI-HANDOFF.json. The current transport claim is owner-file-transport-20261008.

GitHub requires workflow_dispatch definitions on the default branch. Deploy only this intake workflow and necessary governance/test compatibility through release; retain the implementation on development. Do not promote the broader development branch while scientific gates remain pending.

The live intake still needs CRUCIBLE_SOURCE_BUNDLE_KEY (and optionally its PREVIOUS counterpart) and CRUCIBLE_LEARNING_STATE_DEPLOY_KEY in the configured authenticated host. Do not paste keys in chat, generate new state keys or bypass any missing credential. The connection uses the existing private custody repository rather than a public upload or arbitrary HTTP endpoint.

## Operator sequence after governed deployment

Use an authenticated host with the existing raw key configured and the canonical raw custody identity verified. Create a private file-list JSON with absolute local paths for the five original PDFs in files and the two catalogs in supportingFiles. Do not add the catalogs to files; they are supporting metadata, not independent evidence.

1. node src/ownerFileTransport.js pack --file-list /private/files.json --output /private/request.enc --project-id github:jonathanblunt1214-lgtm/The-Crucible --repository 6076446993/The-Crucible --ref refs/heads/development
2. Clone the existing private 6076446993/Crucible-Learning-State repository through the already authorized transport. Capture its current head and manifest; never initialize a replacement repository.
3. node src/ownerFileTransport.js stage-request --request /private/request.enc --request-sha256 <exact hash returned by pack> --state-root /private/raw-state --repository 6076446993/The-Crucible --ref refs/heads/development
4. Make a visible, normal, non-force commit of only owner-intake/<hash>.enc in that private state checkout, and push it using the existing raw custody write identity. This stages a request; it does not change the candidate queue or make a submission receipt.
5. Owner/authorized operator dispatches owner-file-intake.yml on development with that exact encrypted-request hash. Dispatch scope is the owner approval allowlist for the request.
6. Retrieve owner-file-intake-<run_id> receipt. PUBLISHED_RAW_CANDIDATE_CUSTODY confirms successful git publication; ALREADY_PRESENT_NO_PUBLICATION confirms a duplicate-only request. PREPARED_NOT_PUBLISHED never means a live submission completed. Retain actual source IDs/admitted/alreadyPresent counts. Candidates remain extraction-pending under normal independent pipeline gates.

Encryption authenticates the request and its immutable digest binds the owner-approved content. Only the raw key family may decrypt it; vetted custody keys are not used. The source-store identity is derived from authenticated canonical custody; legacy identity is not reset after the repository transfer.

## Remaining work and rollback

Remaining: exact-head hosted gates and independent review; authorized narrow workflow deployment; authenticated live request staging/import; real receipt. R3/R8/R9 remain separate and unchanged. No proof gates are satisfied by this transport.

Rollback: do not execute import while the workflow is unreviewed. For a failed local or hosted prepare, the original snapshot is untouched. For publication, rawCustodyPublisher preserves the prior encrypted manifest/chunks and refuses stale input; a non-fast-forward git push fails rather than forcing concurrent custody aside. Never retract candidates merely to roll back code.
