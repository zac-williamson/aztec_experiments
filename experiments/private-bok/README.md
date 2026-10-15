# Private Bok escrow experiment

G14 / Draft 3 RC23–24. Standalone Aztec **6.0.0-rc.1** protocol experiment, not the deployed product. Public authentication of Bok is intentional. Human account addresses never enter a public request callback, public balance map, or request storage. This source requires independent review, compilation and actual execution before any passing claim.

## Protocol

`claim(amount,recipient_salt,bridge_secret,leaf_index)` privately consumes an authenticated L1 Inbox message and creates `Owned<BalanceSet>` credit. The legacy portal `PLUGIN_CREDIT_V1` **bytes remain unchanged**, but its `account` word has new semantics: a fresh commitment, not an address. Compute `poseidon2([chain,portal,escrow,version,owner,salt], 0x424b4301)`. Use a cryptographically random nonzero salt for each deposit and retain it encrypted for recovery. L1 sender, value and timing remain public. This experiment never credits balances through an administrator mint function.

`authorize_request(request_id,invocation_hash,budget)` privately spends credit, retains private change, creates a private control note, and creates **two distinct fresh partial refund notes**. The public `only_self` continuation creates waiting escrow. Use a random nonzero request ID. The stored nonzero target hash binds this authorization to immutable intended content and relationships. The configured board calls `on_invocation(request_id,derived_invocation_hash)` and must derive the hash from its actual canonical invocation. A client-supplied hash without recomputation is insufficient. A separately submitted authorization may wait and be privately cancelled; atomic authorization+posting in the product wallet is a later integration check, not a protocol property claimed here.

Target v1 is Poseidon2 domain `0x52434931` over exactly 45 fields:

`[1,chain_id,rollup_version,board,adapter,subboard,parent,root,kind,name,referenced_post,nonce,message_length,...message[32]]`.

Message words contain 31 big-endian bytes with right-zero padding, at most 992 bytes. Kinds are post=1, quote=2, repost=3. New roots use parent/root zero. Nonce is nonzero. `InvocationProbeBoard` derives this hash and calls escrow; it checks basic domain/relationship/packing rules and contains no arbitrary hash-forwarding entrypoint. It is a protocol fixture: full UTF-8 validation, canonical relationship existence, private name ownership, admission and moderation belong to the real board and are **not implemented here**. Its test data is a synthetic repost. The Noir cross-vector is bound to the lead's shared JavaScript vector for `Build this page`.

The public operator reserves a bounded maximum for one `(request_id,sequence)` at a time. It settles an authenticated actual cost no greater than the reservation, with a nonzero receipt identifier. Receipt identifiers are one-use across the entire escrow, including across different requests; the operator journal must bind the provider receipt to this request/call. The contract authenticates the operator and bounds cost, but cannot establish provider billing truth from a hash. No new call is allowed within the final two hours of a request's one-day lifetime. These durations are reversible experiment defaults, not new owner decisions.

Every saved request enforces checked integer conservation:

`available + reserved + charged + refunded == budget`.

The state transitions are:

| Current state | Action | Result |
|---|---|---|
| Waiting | Matching board invocation | Active, same deadline/target/budget |
| Waiting/active, unreserved | Private owner cancellation | Closed, primary refund, both channels closed |
| Active, unreserved | Operator finish | Closed, primary refund, both channels closed |
| Waiting/active, deadline reached, unreserved | Anyone expires | Closed, primary refund, both channels closed |
| Active with reservation | Operator reports uncertainty, or anyone expires after deadline | Fenced, primary refunds only unreserved credit; reservation remains payable |
| Fenced | Operator authenticates original call receipt, including after deadline | Charge actual cost; secondary refunds reserved-minus-actual once; closed |

Fenced requests never start another call. Missing receipts never count as zero cost. If an operator cannot reconcile an uncertain provider outcome, the reserved portion remains a concrete external blocker indefinitely; unrelated available credit is already returned. There is no administrator sweep or elapsed-time shortcut. Recovery reconciles the existing provider request and chain hashes and must never repeat a paid call merely to obtain a receipt.

`PartialUintNote.complete` in this SDK is neither caller-authenticating nor one-use. The only completion paths here are internal accounting helpers guarded by authenticated state transitions and independent channel flags. Zero refunds close the relevant flag without creating a zero-value note. The second channel is used only for a fenced request's one outstanding reservation. Normal terminal completion closes it unused. Completion uses the fixed `Owned` balance storage slot; it does not publish an account-derived slot.

`withdraw(amount,recipient,nonce)` spends private credit and emits the exact legacy `PLUGIN_EXIT_V1` message. `withdraw_earnings` spends only operator earnings and emits the same format. Both share a one-use withdrawal nonce namespace; use a fresh random nonzero nonce. L1 recipients, amounts and eventual redemption are public. The existing portal must be independently deployed/configured for this escrow; attaching this code to an already funded old-address-semantic deployment is unsupported.

## Build and checks

Use the repository's pinned Node **24.21.0**, compiler **1.0.0-rc.3 / 5a7ee9bf5ed8973076df7bb0d2b723024db09ae7**, bb and Aztec package checks in `scripts/toolchain.mjs`. Dependencies in this package use the exact V6 tag and the repository's locked dependency trees. This local workspace has separate escrow, probe-board and test packages; Nargo permits one contract per package. It is outside the billboard Nargo workspace. Do not change its workspace to run the experiment.

The lead owns the serialized compiler/TXE slot and global source inventory. From the repository root, the final build command is `node experiments/private-bok/build.mjs` using the pinned executable. It compiles this package, runs the existing artifact processor and VK/dependency checks, and writes a build manifest binding source/toolchain/lock hashes and both artifacts. It never disables the private-function VK check. The initial compiler-only step allows the lead to register normalized raw artifact dependency inventories for `PrivateBok` and `InvocationProbeBoard`, plus this workspace and its three package manifest hashes, in `noir-dependencies.json`. Preserve all existing package/source hashes and origins, and independently check new embedded sources against their locked tree. No inventory bypass is provided.

For TXE, run the pinned Node executable with `experiments/private-bok/test.mjs` from the repository root after building and registering the normal artifacts. Optional `--filter exact_test_name` runs one compiler-discovered test and rejects unknown names. The helper verifies both processed artifact hashes, their embedded local and dependency sources, normal private VK presence, and the complete build manifest before and after execution. It reuses `scripts/txe-c01-service.mjs` and `runWithService` with a random loopback port, one TXE worker, one test thread and a 540-second test limit; the existing lifecycle helper handles interruption, timeout and cleanup. It never builds artifacts or disables constraint checks. Lead may run exact filtered tests to bound early diagnosis. TXE evidence remains separate from real-proof acceptance.

Tests cover claim/message replay and wrong owner/amount/secret/salt/domain/leaf; fragmented private notes; separate waiting authorization and cancellation; derived-target hijack rejection; operator and `only_self` forgery; one unsettled reservation; exact repeated call accounting; zero/partial/full refunds; terminal/expiry/reconciliation cross-path replay; global receipt replay; deadline rejection; and private/operator withdrawal balance separation. Tests use the official `TestEnvironment.send_l1_to_l2_message` test control. **Those seeded leaves are not token deposits, L1 solvency, real proofs, actual provider receipts, or a portal round trip.** Withdrawal effects and full private-note rediscovery need the canonical actual-chain driver described in [DRIVER_HANDOFF.md](DRIVER_HANDOFF.md).

## Evidence and limits

At the initial implementation handoff, TXE execution, VK generation, actual transactions, provider model calls and privacy traces have **not run**. Raw compiler diagnostics and the latest compile outcome are tracked separately; compilation alone is not acceptance. A source review or JavaScript syntax check cannot satisfy G14-A02. Development measurements may explicitly use `realProofs:false`, labelled `proofs-disabled`; real proof acceptance remains missing until separately measured. The driver must use shared private fee payment before making a human privacy claim: genesis fee payer fixtures reveal a human address and are only protocol/accounting diagnostics.

The first serialized raw compile emitted both artifacts with exit 0 after import/workspace repairs, but also produced **49 pinned SDK Brillig manual-constraint diagnostics**. No constraint-check skip flags were used. [Compiler evidence](evidence/raw-compile-summary.json) preserves all attempts, source/artifact/log hashes and diagnostic sites. This requires independent diagnostic disposition; exit 0 alone is not a clean assurance result.

Required observers include public archive, node and index/backend. Public request target/budget/receipt/cost/refund amounts and timing remain linkable to that request. Partial-note tag lookups, node public-key lookups, funding sizes and withdrawal timing may correlate activity; a private storage layout does not prove network anonymity. Partial-note V6 delivery internally uses `onchain_unconstrained`, so key-assisted recovery and actual discovery must be exercised. The remote prover sees private witnesses under the specification's trust allowance. No developer or service credential belongs in these calls or public evidence.

This contract has immutable operator/board configuration, no governance/rotation and no full workspace execution policy. Unit credit conversion, admission collateral, fees, portal readiness/finality, real model receipts, restart fencing and independent privacy review remain integration or release gates. Stale control notes after public completion may remain locally visible; their public terminal guards prevent reuse but wallet cleanup is downstream.

Source basis (pinned `aztec-nr/v6.0.0-rc.1`): `aztec/src/state_vars/{owned,private_set}.nr`; `balance-set/src/balance_set.nr`; `uint-note/src/uint_note.nr` partial generation, validity and zero/multiple completion caveats; `aztec/src/context/private_context.nr` message consumption and portal outputs; `aztec/src/test/helpers/test_environment.nr` official isolated test APIs. Repository basis: `billboard/private_fee_contract/src/main.nr` recursive subtraction; `billboard/portal/src/PluginPortal.sol` exact V1 formats; `shared/rolling/PRIVACY_DESIGN.md` and current G14 requirement map.
