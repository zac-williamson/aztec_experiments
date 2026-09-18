# Application tests

Use the pinned Node24 runtime and Foundry versions in BUILDING.md.

- `npm run test:application:unit`: contract execution in TXE, Solidity portal tests,
  and client/artifact tests. TXE supplies test messages and note-tree fixtures;
  these tests check application constraints, not network proving.
- `npm run test:application:bridge`: real application transaction proofs and node
  verification, actual local Inbox claims and Outbox consumption, portal activation,
  deposit-note delivery/burn, refund accounting and duplicate rejection. The parent
  enforces a nine-minute deadline and cleans its owned processes on failure.

- `node scripts/test-c01-application.mjs --screening`: real deposit claim and two
  real post proofs, checking authenticated screening and exact private-note state.
  Uses the same nine-minute bound; writes evidence under `execution/evidence/C02`.

- `node scripts/test-c01-application.mjs --redeposit`: two genuine deposit/claim/exit/refund cycles for the same user, rejecting old claim and consumed exit data against the fresh receipt. Under qualification; same aggregate limits apply.
- `node scripts/test-c01-application.mjs --flagged-journey` and `--unflagged-journey`: integrated private-fee posting, screening, eligible withdrawal and actual L1 refund. The unflagged profile also rejects an actual wrong-origin Inbox message and missing deposit-chain withdrawal before the valid journey. Successful execution is required before claiming coverage. Evidence is retained under `execution/evidence/T02`.
- `node scripts/test-c01-application.mjs --private-fee-post`: user-funded private fees, production L1 funding/recovery helpers, first-use claim and subsequent private posting.
- `node scripts/test-c01-application.mjs --proof-recovery`: genuine stale real-post proof, conflicting private fee spend, encrypted journal restore and same-post replacement.
- `node scripts/test-c01-application.mjs --note-attribution`: genuine unsubmitted screening proof and withdrawal of the same private deposit note, stale-proof rejection and L1 refund. This qualifies attribution, not a combined regenerated-screening race.
- `node scripts/test-c01-application.mjs --private-fees`: standalone fee-balance funding, private board claim/withdrawal and actual local L1 refund. Both private-fee profiles retain the nine-minute deadline.
- `node scripts/test-noir.mjs --filter private_fee`: ownership, replay and insufficient-credit constraints. Positive fee election is covered by genuine transactions because pinned TXE starts calls in the application phase; see `billboard/private_fee_test/INTEGRATION-BOUNDARY.md`.

Native runs are serialized, with a540-second deadline and a sampled2GiB owned-process RSS limit. The contention and posting-diagnostic profiles use two native client proving threads; other profiles use one. Node verification and world-state hardware concurrency remain one in all profiles. This is a per-process thread setting, not parallel proof jobs. Browser profiles close after their checks; no heavy jobs run beside native proving.

The bridge test uses the installed Aztec SDK's `RollupCheatCodes` and
`settleEpochOutbox` to advance local epochs and settle actual emitted messages.
Network epoch proofs, protocol verifier qualification and Ethereum finality are
outside this application test. Settlement is explicitly labelled test-controlled;
application proofs and message membership/consumption are still checked.

No custom AVM build, server prover, epoch proving CRS or Docker is needed for these
checks. The installed native client prover and normal application proving assets
are used. The old `test-c01-real-network.mjs` entrypoint is retired and fails with
a pointer to the application test instead of launching network proving.

A passing application suite is not deployment clearance or an independent audit.
Supported-network smoke tests and the release checks remain in the execution graph.
Historical network-proving experiments remain recorded under execution/evidence;
they are not development prerequisites and must not be resumed by the graph.

## Contract invariant and diagnostic checks

`python3 fv/model-checks/check.py` explores bounded reachable bridge/screening
states and requires intentionally broken variants to yield counterexamples. It
prints interpreter/source identities and exact bounds; it is not an implementation
equivalence or cryptographic proof. Historical Lean/Verity claims under `fv/` are
retired and cannot be counted as acceptance.

`node scripts/check-compiler-diagnostics.mjs NEW_OUTPUT_DIRECTORY` performs a fresh
compile in an owned scratch workspace with a180-second deadline and constraint
checks enabled. It checks pinned dependency source inventories, declared function
identity and exact private ACIR against canonical artifacts, accounting explicitly
for the pinned generated public dispatcher. Raw diagnostic logs are retained;
passing correspondence does not resolve their security meaning. CurrentT01
records57 occurrences at18sites across board/private-fee contracts, with all26
original observations preserved.

The `--screening` genuine application profile now tests altered included-note
randomness and settled nonce. A test-only node wrapper supplies the authentic
sibling path only for the exact altered absent leaf at the same anchor. Noir must
reject its membership constraint, after which the unmodified post must still
prove and be included. These are constrained-witness rejection probes, not
completed hostile proofs or a test of arbitrary kernel modifications.

`node scripts/test-c01-application.mjs --contention` qualifies ten distinct authors
preparing genuine transactions from the same anchor before submission. It retains
the540-second/2GiB sampled limit. The local one-transaction-per-block geometry
tests conflict independence and correct publication order, not production TPS.

## Browser lifecycle and restart recovery

Run these serially through the aggregate supervisor, which includes browser,
native fixture and controller processes in the same 540-second / 2GiB bounds.
Use a new evidence output filename for each run:

```sh
node scripts/run-bounded-browser-check.mjs scripts/test-c01-application.mjs execution/evidence/T04/lifecycle-NNN.json --browser-journey
node scripts/run-bounded-browser-check.mjs scripts/test-c01-application.mjs execution/evidence/T04/recovery-NNN.json --browser-post-recovery
```

The lifecycle profile performs actual UI deposit, claim, post, screening,
withdrawal and Ethereum refund. A fresh native wallet then verifies canonical
transactions, the private note chain, consumed nullifiers and fee accounting.
Private fee credit is funded natively beforehand; the disposable Ethereum wallet
adapter does not qualify third-party wallet extensions. Lifecycle022 passed in
483244ms with sampled aggregate peak1729856KiB and complete owned cleanup.

The recovery profile withholds the response only after a genuine post submission
is accepted, closes the full browser before normal in-process reconciliation,
and reopens the same temporary profile. The UI restores the same wallet identity
without importing journal records, then recovers the original saved transaction.
Native verification requires one accepted submission, one canonical post and one
private fee debit. It does not count discarded or unsubmitted proofs. Successful
source/unit checks alone do not qualify this scenario; inspect its actual run
report and cleanup. Recovery025 passed this scenario in274958ms with sampled aggregate peak1772256KiB and complete owned cleanup. Other interrupted stages and browsers remain separate qualification.
