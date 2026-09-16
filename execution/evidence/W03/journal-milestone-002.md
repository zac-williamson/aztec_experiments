# Encrypted user L2 recovery milestone — W03 remains active

Source: `source-journal-006.json`; fingerprint
`7558ad896fda2fc731ab586d068622220557cc8b86d907469ee60266146643cc`.
Pinned Node24.21.0 / Aztec5.2.0. No public transactions or network epoch proofs.

## Delivered

The browser and user CLI instantiate an encrypted journal for user L2 claim,
post and withdrawal, including those stages inside auto. The engine refuses these
operations without a journal. The real wallet implementation checks prior state
before proving, atomically saves the exact serialized transaction before broadcast,
and stops if encryption/storage/read-back fails. Domain-separated encryption uses
the wallet key and full salt, authenticated against account, chain, rollup/version,
board and portal. Browser writes await IndexedDB completion with strict durability;
CLI writes use private modes, exclusive locks, atomic replacement, fsync/read-back.

A new session must reconcile the saved transaction before starting another.
Recovery never generates a new proof: it queries the exact hash and can resubmit
identical saved bytes when the node says the dropped transaction is still valid.
The live page acknowledges only a result returned by the engine. A CLI new action
requires an explicit `--acknowledge-tx` hash. Both require fresh canonical receipt
validation before replacement, including after an earlier successful display.
Canonical reverts are reported as failed actions but can be explicitly acknowledged;
pending, uncertain or reorganized outcomes cannot be acknowledged as complete.

The current record is retained until the next acknowledged transaction replaces it.
This is a latest-transaction recovery record, not yet a complete operation history.
A stale/invalid dropped proof is held for future logical-operation reconciliation;
there is no blind proof regeneration or automatic record deletion.

## Verification

- `journal-integration-006.log`:148 passing tests. Includes20 encrypted journal
  checks across filesystem and IndexedDB, actual SDK serialization/deserialization,
  competing prepares, authentication/scope isolation, corruption, canonical reorg
  checks, fail-before-send ordering and recovered-revert UI/CLI classification.
- The journal tests kill a separate writer with SIGKILL after prepare, then recover
  in a fresh session. Only saved identical bytes reach the controlled RPC.
- `browser-journal-005.log`: actual built browser page reload, wallet restoration
  from encrypted backup into the same profile, retained IndexedDB journal,
  replacement blocking and exact-hash recovery; existing fresh-profile wallet,
  claim-secret and cross-tab tests also pass. No external requests occurred.
- `cli-sdk-journal-005.log`: actual built SDK through CLI loader boundaries.
- `artifacts-journal-005.log`:93 artifact/provenance/affected-client checks pass.
- `sdk-journal-004.log`, `apps-journal-006.log`: canonical builds succeed.
- `artifact-manifest-journal-006.json`, `manifest-journal-006.log`: fresh validated
  inventory after the final CLI outcome-label repair.

Synthetic full-size transaction/proof objects test preservation and recovery
mechanics. They are not valid cryptographic proofs and are not represented as a
new genuine transaction journey. Existing native proof evidence is historical.
Root diff review additionally caught missing-journal bypass, private-fee error-code
redaction, recovery wallet-context races and misleading CLI revert-success labels.
No delegated or external final review is claimed; prior agents report quota errors.

## Open work

Ethereum deposit/refund/fee-funding stage records and matching canonical events;
portable encrypted journal backup/restore; logical IDs linking stale-proof
replacements; other deployment/moderation consumers; persistent scan cursors and
full-stage interruption tests. Browser storage eviction, deleting the CLI journal,
or restoring keys on another device loses pending provenance: the wallet backup
currently contains keys and claim secrets only. Stale file locks fail closed and
need careful offline inspection. These limitations keep W03 active.
