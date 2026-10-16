# Vetted custody storage growth: verified read-only findings (2026-10-16)

## Authority
Crucible-Vetted-Learning-State is independently owned vetted custody. This record grants no authority to change ciphertext, signed events, quarantine, keys, ownership, history, or publisher.

## Verified live repository sizes
GitHub reports the following repository size fields in KiB, not independently measured disk allocation:
- 6076446993/Crucible-Vetted-Learning-State: 59,517,884 KiB (~56.8 GiB)
- 6076446993/Crucible-Learning-State: 1,375,503 KiB
- 6076446993/Learning-Worker: 732,425 KiB
- 6076446993/The-Crucible: 5,045 KiB

## Verified ciphertext and semantics
At vetted commit d0e9be11bf5c6fc77c84f0222923b1a599090ece, the encrypted chunks manifest reports three chunks totaling 213,833,785 bytes.
Six independently published vetted commits had their complete encrypted-custody-report.json reports compared: d0e9be11bf5c6fc77c84f0222923b1a599090ece; 6fce45b484ea3eb6b4b573774f69747e1454d1b5; ffe276d9e10e76e1cf88e69867bd582813a2e8bd; 3e931e54d76ec44425b4c90dd819a40fc5d889f6; 6163a06d9549923c9d28ee4ca299dcdfcc238d37; 9eedbce21398d515dce0d1f36aea44251ed8f300.
All six reports were structurally equivalent after omitting only source/vetted ciphertext digests, top-level generation timestamp, and worker-export previous-vetted-state SHA, generation timestamp, and plaintext SHA. All actual 406 source reviews, 381 approvals, 25 quarantines, queue hash, learning hash, and non-excluded worker evidence matched exactly. Each had a distinct ciphertext SHA and approximately 213.8 million encrypted bytes. Five additional copies in this sample contain approximately 1.07 billion logical encrypted bytes, not independently proven recoverable disk savings. Historical signatures exist in the repository but have not been validated by an independent signer here.

This is positive evidence that repeat encryption of substantively unchanged custody states could inflate Git history; it is NOT proof that the six signed inspection and publication events are redundant or dispensable. Exact Git object packing and all other commits remain unmeasured.

## Implemented additive Crucible development components
- scripts/custodySubjectGrouping.js preserves each candidate identity, assigns multiple subject references, and holds uncertain subjects for review.
- scripts/rawCustodySubjectEvidence.js and test/rawCustodySubjectEvidence.test.js map authenticated candidates, provenance digests, and subjects in read-only mode. Raw candidate text is never exported in the report.
- .github/workflows/retained-custody-inventory.yml runs that work within the isolated authenticated raw-custody verifier and retains only aggregates and hash-bound indices. It has not authorized R2 restart.
- scripts/evidenceContentAddressedStage.js provides ephemeral source-copy and full-reference roundtrip verification; it is not a production migration.
- scripts/vettedSnapshotEquivalence.js flags strict vetted semantic-equivalence only and explicitly denies publication authority.
- .github/workflows/evidence-storage-audit.yml attempts a Git history audit; do not treat it as successful full vetted-state audit or physical reduction without run evidence.

## Next independent publisher control
Only the oversight-controlled publisher may suppress redundant re-encryption. Its separately authorized implementation must: inspect and vet every new event normally; compute a strict schema-validated digest including every substantive source decision, candidate state, refusal, quarantine, provenance, policy and lineage; compare only with authenticated previous vetted state; record a new independently signed and immutable no-content-change inspection receipt bound to the prior ciphertext SHA/commit; leave content unchanged only when all substantive facts and lineage match; fail closed on signer, quarantine, evidence, permission, state, policy, or lineage changes; and prove consumer compatibility.

No-change publication must not suppress or fabricate STOP/CLEAR or approval, mutate candidate history, grant scientific proof, or bypass independent oversight. A signed no-change inspection event is different from dropping an inspection.

## Historical footprint recovery remains gated
Before removing any old ciphertext from Git: independently inventory all history and external readers; move all required historical ciphertext, manifests, signatures and exact lineage to protected, independently controlled retention storage; verify complete byte-for-byte restoration under a separate principal, including originals and quarantined evidence; and obtain independent oversight approval and explicit owner authorization. Do not rewrite Git history, delete objects, run destructive garbage collection, rotate keys, restart R2, or promote main by default.

Status: root-cause evidence and additive group/index implementation are recorded. Exact 52+ GB recoverable savings, publication suppression, production migration and independent historical restoration are NOT yet verified.
