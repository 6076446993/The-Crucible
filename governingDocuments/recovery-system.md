# P0 recovery system

Owner scope: recovery only, on `6076446993/The-Crucible:development`.
R2, queues, live candidate custody and `main` must not be restarted, reset,
discarded or promoted by implementation or verification. Local passing tests
are not independent live-corpus verification or permission to release.

## Preservation population

The configured population is complete directory trees, not sampled files.
`recoverySystemCli.configuration` requires declared coverage for knowledge,
research source logs, original material, candidates, evidence, custody,
learning versions, extraction progress, unfinished work **and plans**.
Missing declared coverage fails closed. Declaration is an inventory contract,
not proof that an operator identified every real storage location.

Plans are recoverable state. Include `AI-HANDOFF.json`, `DEVLOG.md`, governing
research/development plans, work ledgers, original request/observation dates,
stable task IDs, priorities, dependencies, blockers, decisions, ownership,
partial source changes and their Git history. Recovery restores their exact
bytes. It must not mark an unimplemented item complete, reset its age, replace
an original instruction with a summary, or silently discard unfinished work.
Library-only plans and remote custody must first be reconciled into the
explicit project inventory; this implementation does not infer their contents
from filenames or claim they are all present in this checkout.

## Native integration

`recoverySystem.preservedReplace` is used by the durable scientific learning
store, extraction queue, discovery candidate sink, Google/Perplexity/model-pointer
research logs, monthly refresh log, learning orchestrator ledger and durable
organism runtime. Hosted queue hydration/restaging also uses this boundary.
Existing native queue/store locks remain. A separate recovery-journal lock
serializes competing writers at the preservation boundary.

Before replacement, both original and proposed complete bytes are stored in
create-exclusive, content-addressed generations under `.crucible-recovery`.
A chained immutable intent is flushed before publication. A committed marker
is flushed only after the target is published and checked. Files and directory
entries are flushed; an unsupported flush is a refusal, not a durability pass.
No retention pruning, deletion operation, queue reset or knowledge promotion is
provided. Budget storage accordingly; exhausted or unavailable storage must
inhibit writes, never trigger automatic deletion of old evidence.

A tracked missing store cannot be initialized as a new empty learner. Changed
committed bytes, corrupt generations and unresolved intents inhibit restart.
Exact-hash replay finishes only the recorded transaction, accepts its known
preimage or already-published intended generation, and refuses unknown bytes.
Repeated replay is idempotent. An old checkpoint is not authority to overwrite
newer committed candidates. Queue/store replay holds native and recovery locks.

Recovery history is private data: preimages may contain original source
locations or research text. Keep it in protected private custody and encrypted
transport. File modes are restrictive, but mode bits are not independent
storage, retention lock, credential separation or Windows ACL proof.

## Consistent checkpoints and independent copies

Checkpoint configuration explicitly names absolute population roots, a separate
vault, exact project and development revision, and every native writer lock.
All specified locks remain held across first inventory, copying and second
inventory. Missing, symlinked, hardlinked or changing material fails closed.
Original files are hashed with bounded reads and copied with native bounded
I/O. Directory entries, empty directories, exact paths, sizes and SHA-256 hashes
are recorded. Unresolved native journals cannot become a valid checkpoint.
The manifest is published last under its own SHA-256. Partial objects are not a
complete checkpoint, and checkpoint creation can be repeated without replacing
prior content. The native writer-lock inventory must be independently reviewed:
a caller-supplied lock list cannot prove that every external writer cooperates.

The vault has no delete or overwrite operation in this module. It is nonetheless
**not** immutable against a worker with arbitrary filesystem credentials.
Provision versioned, retention-locked, encrypted recovery storage outside the
worker's deletion and key-management authority, using a separate recovery
principal. Existing source-bundle encryption remains available; no master key
is generated, copied into governance, or silently rotated here.

`restore` reconstructs into a new isolated empty directory and binds partial
progress to the exact checkpoint digest. A repeated interrupted restore may
complete matching files only. Unknown existing bytes are retained and refused.
Manifest/project/object checks precede restoration; final population comparison
checks exact path/count/type/size/hash equality, including identity and provenance
records and unfinished plans. A successful local restore explicitly reports
`independentStorageVerified:false` and `restartAuthorized:false`.

## Autonomous orchestration

`RecoveryController` accepts only registered same-project operation IDs; research
payloads cannot supply paths or shell commands. It invokes the existing native
checkpoint/verify/restore/replay/authorization entry point, records outcomes in
durable diagnostic custody, and reports missing dependencies as held work.
Failures do not silently disappear or become scientific evidence.

`CrucibleLearningOrchestrator.coordinate({recoveryTasks})` executes the bounded
registered recovery tasks first. Requested extraction/evaluation remains held
until the recovery result carries independent restart authorization. This
request does not authorize running extraction, evaluation, R2 or other work.

Production circulation registers a recovery handler. The brain may route a
bounded `recover` plan to it; `submitRecoveryTask` can submit a registered
operation directly. A held recovery request remains queued under its original
ID, retains its attempt history, and becomes eligible on a later heartbeat
after a bounded one-minute delay. It is not added to completed deduplication
keys or quarantined merely because an external recovery dependency is absent.
Independent oversight STOP remains effective. No new daemon or schedule is
created; actual autonomous execution depends on the existing runtime being
deployed, configured with the operation registry, and receiving heartbeats.

## Restart authorization

CLI verification of current populations is read-only and grants no restart.
Authorization additionally requires an independently pinned Ed25519 verifier
key and a signed, non-expired receipt binding the exact project, development
revision and checkpoint. Worker, verifier and recovery-custodian identities
must be distinct. The receipt must attest restoration, complete population
verification, effective worker deletion denial, and retention protection through
the authorization expiry. There is deliberately no receipt-signing operation.

A valid signature establishes who signed an assertion; it cannot establish
the truth of a storage permission or restore claim without the independent
execution evidence. Public-key pinning, signer custody, effective permissions,
retention lock, encryption/recovery keys and actual live restoration remain
deployment acceptance requirements. The worker must not be able to replace
the pinned public key or its operation configuration.

The signed authorization is a recovery preflight, not a new power to release
knowledge, clear an independent STOP, restart R2 or promote `main`. Current
low-level APIs retain their native per-file guards; complete live deployment
must route all restart/mutation entry points through the configured recovery
preflight. This checkout alone does not prove universal deployment enforcement.

## Verification and evidence limits

Tests cover original preimages, deleted native-store refusal, queue truncation,
intent/publication interruption, actual SIGKILL, fresh-process inhibition,
native candidate-commit replay with count/identity/provenance preservation,
idempotent replay, tampered blobs, wrong identity, missing manifests, concurrent
mutation, symlinks/hardlinks, empty directories, partial restoration, preserved
plans and priorities, unsigned/expired/self-identity receipt refusal, autonomous
orchestrator execution and durable held-request retry.

The missing-store regression is also run against the original source with the
new test retained: it fails because the original constructor recreates an empty
store; restoring only the source fix makes it pass. Separate-process restoration
from a vault after deleting a disposable source tree proves local reconstruction,
not a distinct security principal or verified recovery of the live corpus.

Directory-flush behavior, real storage power loss, independent administrative
deletion, effective backup retention, key recovery, real multi-writer quiescence,
remote custody completeness, Windows/macOS runtime behavior, and exact-tip
hosted checks remain unverified until their actual execution evidence exists.
Do not claim zero knowledge loss while any acceptance requirement is missing.

## Primary design references

- SQLite atomic commit: https://www.sqlite.org/atomiccommit.html — durable
  ordering and directory synchronization matter in addition to atomic rename.
- SQLite corruption guidance: https://www.sqlite.org/howtocorrupt.html — broken
  synchronization or inconsistent backup assumptions invalidate crash claims.
- Microsoft FlushFileBuffers:
  https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers
  — native flush behavior and failures need platform-specific verification.

These references informed the durability checks; this implementation is not
SQLite and does not inherit SQLite's crash-test proof or ACID guarantees.

## Hosted follow-up and P0 operating hold

Commit `0c651b413753787b3922242e2323977bcafad176` passed CodeQL, handoff, conflict governance and encrypted-custody checks. Its Self-Test exposed two platform differences: the macOS operating-system temporary-root alias was rejected, and Windows directory flushing with a read-only handle returned `EPERM`. The macOS fix canonicalizes only the exact inherited OS temporary-root mapping; additional symbolic aliases remain refused. The Windows follow-up uses the write-capable handle required by Microsoft FlushFileBuffers and preserves a coded `open`/`flush` refusal if that platform still cannot supply directory durability. Hosted verification of both fixes remains required. No fallback silently drops directory durability.

The owner recovery-only priority is now durable in `recovery-operation-policy.json`. Known normal research/provider calls, source retrieval, extraction, operator intake, scientific-learning mutation, hosted proof, ordinary orchestrator work and production repair/digestion are held for both current and retained Crucible project identities. Recovery tasks, read-only diagnostics, isolated fixture verification and other projects remain separate. The first push triggered an existing discovery workflow; it was explicitly canceled (run38794379726). Existing hosted proof run38794379221 had already finished with its previous R8-pending failure and retained its artifacts; its isolated R2 fixture is not a restart of the live R2 pipeline. Later normal invocations must report the P0 hold. Low-level snapshot APIs are retained for isolated recovery verification; all deployed launch paths still need independent inventory and acceptance.

## Authenticated hosted custody preservation

The development-only `recovery-custody.yml` captures exact current raw/vetted committed trees and tip metadata, complete development Git history/source/plans, available research caches, and the latest available retained hosted-state artifact. Existing keys authenticate encrypted original material, candidate/evidence identities, source queues and extraction progress, learning versions and the complete payload before and after recovery. It never initializes a learner or publishes to either custody repository. Missing/invalid retained state fails closed rather than falling back past a corrupt generation.

`hostedRecovery` invokes the registered RecoveryController checkpoint, seals schema2 vaults using an HKDF-SHA256 composite of both existing raw and vetted key families, uploads encrypted bytes and bounded digests/counts, then restores only that uploaded backup on a fresh runner without custody SSH keys. Exact replay must leave the result unchanged. Partial captures are encrypted for diagnosis and cannot authorize restoration success. No plaintext corpus, original sources or keys are uploaded.

A captured immutable revision vector is consistent at its declared Git commits and artifact identity; it is not a quorum of live writers or proof of complete deployed roots. GitHub90day artifact retention is not WORM protection. A separate job is not a distinct security principal. All independent storage, recovery-key custody, verifier signature and deployed bootstrap requirements remain enforced. The workflow starts on recovery-source pushes or explicit dispatch; it does not claim a deployed periodic scheduler on this non-default branch. Broader resource findings are preserved in the existing recovery research record without resuming normal research.

The first full-history attempt exposed a capacity constraint: authenticated GitHub metadata reports vetted repository storage of59,517,884KB. Standard hosted runners cannot hold that history. Current-tree preservation proceeds without unshallowing private repositories, and complete historical private Git replication remains explicit held work for suitable independent storage. Shallow tip snapshots never count as full history. The original remote histories are read-only and retained.

Both hosted recovery jobs install locked dependencies with lifecycle scripts disabled before recovery credentials are introduced. Storage cleanup requires authenticated content/provenance comparison and recoverable independent originals; age, ciphertext churn or current-file deletion cannot prove historical Git objects obsolete or reclaim reachable history. Current private trees total924,677,165bytes and can be captured without deleting source history.

Schema2 mixed-custody capsules require both distinct existing32byte custody keys. HKDF-SHA256 combines raw then vetted key bytes, domain-separated by CrucibleRecovery/v1 and the exact repository/ref dual-custody context. Existing AES256GCM source-bundle framing authenticates the result. Only a child process receives the derived environment value; original secrets and parent environment stay unchanged. Neither family alone can open a mixed vault, and no schema2-to-legacy fallback exists. Both original families require independent recoverable custody; this derivation creates no signing or restart authority. Earlier single-family test capsules remain labeled historical evidence pending authenticated rewrap/verification, never silently deleted. Node primary API reference: https://nodejs.org/api/crypto.html#cryptohkdfsyncdigest-ikm-salt-info-keylen .
