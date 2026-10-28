# Private paid likes — implementation handoff

The fresh 20-FEE contract scope and application release `86be52150de16ad6fe628000404e44e3592705bb` are deployed as of 28 October 2026. **Real-proof acceptance remains pending.** Independent source review and native proofs-disabled integration checks passed; these do not establish live acceptance. Old application state is disposable.

## Deployment and current acceptance

The sealed campaign is `/private/tmp/rolling-tips-20261028-r1`; the retained build is `/private/tmp/rolling-browser-proof-spans-build`. Public deployment identities are:

| Contract | Address |
| --- | --- |
| Board | `0x2d6210a94af00fadeb5c69c20ed9fce3e20a8feca7d2b190354307ef0d235bee` |
| PrivateFPC | `0x2d71392cfb41aa25a62c5ecc510400167dda9f3669676d2b539413a4fa0bcbb7` |
| PrivateBok | `0x204a501c723939244387d75b4c8f67a851f21018102c308ceef006f70ef6f534` |
| Posting deposit portal | `0x0c81b38be26619dd8587455ff400ec9c6ab6a0a7` |
| Consolidated funding router | `0x0547e56ac6fdb8952a3435090c8a01f10893b0fe` |
| Bok portal | `0x6183c511c8057a0e4462a9ffb13c37b6c0ab8789` |

The uninterrupted signup attempt paid ETH, then failed during claim preparation with `ROLLING_ABI_MISMATCH`, before any proof submission. The claim-witness helper retained an obsolete ordinary-post gas-profile class requirement. Commit `83f3cb7c54699914a5f57cf95f15c5fd2e8fbc06` fixes this by verifying the deployment against its authenticated Board artifact while retaining exact storage-layout, context and anchor checks. Static publication is in progress; record actual claim completion and paid-like acceptance before marking this release accepted. This correction does not redeploy contracts. Local diagnostic evidence: `/private/tmp/rolling-tips-ui-smoke-attempt3/result.json`.

Historical fee evidence is separate: one 22-byte ordinary post on release `8e68ac4a` and the previous Board paid **2.5016104002576 FEE**, versus a configured ceiling of **124.140375552 FEE**. Its real-proof receipt was checkpointed successfully. That ceiling is a reservation limit, not the measured charge; this single earlier observation does not price the new contracts. [Receipt evidence](../execution/evidence/G21/stable6/private-paid-likes/basic-post-actual-cost.json).

## Value and user action

A paid like transfers **20 FEE = 20 × 10^18 base units**. The existing wallet displays `decimal(balances.fee.available,18) + ' credits (FEE)'`; the funding UI calls these FEE tokens posting credits. `PAID_LIKE_VALUE` uses exactly that conversion in Noir and JavaScript. Network fees are additional and measured by the native transaction fee, not a fixed estimate. The reader has one `Like · 20 credits` action and current private credit balance. Repeated likes each pay20; there is no unlike or free-like entrypoint.

## Keys, notes and authorization

`billboard/private_credit/src/lib.nr` defines the note format and domains. The wallet's native application-scoped nullifier hiding key is the PRF root; its private request is checked by Aztec key-validation requests. No arbitrary client-supplied root authorizes a spend.

* Post secret: Poseidon2 `[Board-scoped NHK, chain, version, board, post]`, separator `0x52435453`.
* Scalar: Poseidon2 `[s]`, separator `0x52435458`, embedded-curve `from_field`. Nonzero is required. Canonical BN254 Fr is smaller than the Grumpkin scalar field, so conversion introduces no alternative scalar encodings.
* Public key: native fixed-base scalar multiplication `xG`. Point coordinates are native Fields, non-infinite, and satisfy `y² = x³ -17`.
* Liker chooses a fresh nonzero Field `r`; native multiplication computes `R=rG` and shared point `rP`. Blinding is Poseidon2 `[shared.x,shared.y,FPC]`, separator `0x52435442`. The author obtains the same blinding from `xR`.
* Commitment: Poseidon2 `[P.x,P.y,blinding]`, separator `0x5243434d`. Inner note hash uses the native NOTE_HASH domain and `[CREDIT_SLOT,commitment,value]`; native contract silo and nonce produce its unique hash.
* Input nullifier uses native NOTE_NULLIFIER domain `[unique note hash,s]`, then native contract siloing. Neither scalar nor shared blinding authorizes spending. Every selected input constrains `s → x → P`, the entire note preimage and native membership before emitting its native note nullifier.

Post creation publishes P and binds its domain-separated hash in one write-once-by-creation slot. Every atomic-thread post binds its own key. The strict public reader validates the PostTipKey curve coordinates and requires its same-transaction PostPublished pair. Human posts use the author's Board-scoped NHK. PrivateBok's authenticated **private** `publish_reply` calls Board's private `derive_plugin_tip_key(operator,request)`; Board derives the deterministic bot reply ID from the calling adapter and request, requests the operator's Board-scoped NHK, and returns only P. PrivateBok's only-self public continuation sends P to the Board callback. Hosted Bok registers the pinned Board artifact in its existing native PXE. No operator secret is inserted into public arguments or journals.

Knowing x does not reveal the hash preimage s. This is separation of spend authorization from ECDH key exposure, not a claim that Aztec or the entire construction is quantum-secure.

## Transaction phases and conservation

Posting fee setup consumes a selection of settled ordinary and/or tip notes, verifies every membership, reserves the transaction's maximum fee, creates private change and a refund commitment, elects the FPC fee payer and calls `end_setup`. The post runs in the application phase of that same transaction. On application revert, setup inputs and change remain committed and teardown returns unused fee reservation.

Paid-like setup consumes selected notes and reserves `maximum fee +20`. Change is `inputs - maximum fee -20`. It registers teardown and ends setup **before** creating the recipient's20 note or enqueueing the Board callback. The application callback checks the post's immutable P, records the paid like and emits a success nullifier derived from the transaction-unique refund commitment. Recipient note, callback, success marker and tip completion log are all revertible together.

Teardown checks the native success nullifier. It returns `maximum fee - actual fee`, plus20 if the paid-like application reverted. The success domain `0x5243544f` and refund validity domain `0x52435256` are distinct. Refund validity is committed during setup. An invalid setup transaction is not includable; a failed application still pays actual gas and returns the principal in the same transaction. Public completion creates the refund native note hash; no claim transaction or claimed-total cursor exists.

Bridge minting retains the native FeeJuice claim-nullifier proof and FPC duplicate-claim protection. Thus new note value can originate only from an authenticated bridge deposit, consumed existing notes, or completing a reserved refund. All amounts and sums use checked u128. Backing remains in FPC FeeJuice, with protocol fees debited there.

## Self outputs and discovery

Self-output secret uses native FPC-scoped NHK, chain, version, FPC, **native transaction protocol nullifier**, role and global side-effect counter, separator `0x52435353`. Roles1/2/3 are change/refund/mint. Blinding hashes that secret with `0x52435342`. The protocol nullifier is the unique input reference; no local counter, saved output secret or source-post reference is required.

There is no encrypted delivery for these credit notes. Shared-tag plaintext completion metadata contains version, role, output counter, commitment and completion value. Change completion publishes its debit (reservation, or reservation+20), **not its change amount**. The wallet reconstructs change from its recognized consumed input nullifiers. Refund and mint amounts are already public. Tip completion publishes board, destination post/P, R, commitment and20. It never publishes a consumed source note/key/post.

`shared/private-credit.mjs` queries paginated native deployment-wide public/private log tags with transaction effects; it sends no owner-specific tags or source-post lookups. It verifies each candidate against a native unique note hash from the effect, derives native nonces from the first nullifier and note position, and ignores outputs without a matching native note. It records nullifiers locally to exclude spent notes. No source-post-specific RPC or owner-specific lookup tag is sent. The incremental cache is kept in the encrypted wallet journal and resets on a changed canonical history; no old-release recovery/migration machinery is introduced.

Discovery visits matching FPC completion history through native tag indexes, then resumes at an encrypted, canonical-checked checkpoint. Zero refunds emit completion metadata without creating zero-value notes. Spending is bounded to **eight input notes per transaction**, selected largest first. The wallet fails before submission when those eight cannot cover the reservation. No unbounded recursive prover work or extra consolidation transaction is hidden. This bound is an implementation limit, not a protocol impossibility. Amounts, destination, timing, transaction size, repeated per-post liker tags and statistical inference remain visible. Explicit linkage to funding posts is absent from contract calls/logs; this is not an anonymity guarantee against all side channels.

## Native primary-source basis (pinned Aztec6.0.0)

The read-only generated dependency tree `.build/owner-delivery/aztec-nr` and pinned installed packages were inspected directly:

* `aztec/src/context/private_context.nr`: `assert_note_exists`, `push_nullifier_for_note_hash`, key-validation requests, `set_as_fee_payer`, `end_setup`, and side-effect phase semantics. Setup public callbacks would be non-revertible, which is why paid-like callbacks are queued after `end_setup`.
* `aztec/src/note/utils.nr`: native note hash/nullifier domains, unique settled-note hashing and the distinct pending previous-phase rule. This implementation admits only settled fee inputs; it does not guess pending-note nonces.
* `aztec/src/context/note_existence_request.nr`: settled read requests. The native kernel/node membership witness is used, not an application membership assertion.
* `aztec/src/messages/discovery/nonce_discovery.nr`: first transaction nullifier plus native note position determines nonce.
* `aztec/src/partial_notes/fsm.nr`: committed validity nullifier and public partial-note completion mechanism; the FPC uses the same native primitives without encrypted note messages.
* `@aztec-labs/pxe/src/private_kernel/private_kernel_oracle.ts`: native note membership witnesses by unique hash.
* `@aztec-labs/pxe/src/contract_function_simulator/contract_function_simulator.ts`: protocol nullifier is the first effect nullifier/nonce generator.
* `@aztec-labs/stdlib/src/interfaces/block_response.ts`, `logs/private_log.ts`, `tx/capsule.ts`: native effect/metadata and private witness transport formats.

## Validation and integration

Focused `nargo check` passed for RollingBoard and private_fee_test. Focused compilation of FPC, RollingBoard and PrivateBok exited0. The pinned compiler prints Brillig analyzer diagnostics labelled `bug` for native phase/key/storage/nullifier oracles and the capsule loader; these diagnostics are not proof of circuit soundness or a clean security validation. Capsule contents are witnesses only: slot and scope choose them, while membership, secret/key relations, native nullifiers and arithmetic constrain their use. No diagnostics were suppressed and no dependency code was changed. Integration now has normal processed contract artifacts and verification keys, the rebuilt SDK,203 focused client/composer/worker checks, a repeated-paid-like browser check, and independent runtime review. The native transaction run passed: two20-FEE transfers, author posting using only a received tip, mixed ordinary/tip inputs, principal refund on application revert, native double-spend rejection and empty-reader balance reconstruction. This used native proofs-disabled development, not real-proof testnet acceptance. The native Bok invocation check also passed: one atomic post/authorization and one atomic reply/settlement/refund, with rollback on either application failure. The fresh contract deployment is now live; real-proof acceptance remains pending. Native evidence is retained in [paid-like transactions](../execution/evidence/G21/stable6/private-paid-likes/native.json) and [atomic Bok invocation](../execution/evidence/G21/stable6/private-paid-likes/bok-native.json).

The deployment rebuilt and generated verification keys for **PrivateFPC, RollingBoard and PrivateBok** with pinned tools, regenerated trusted artifact manifests and the SDK bundle, and deployed fresh classes and instances. Board `init` appends the canonical FPC address; deployment verification checks that immutable binding. PrivateBok `publish_reply` changes public→private while retaining its six caller arguments; its public only-self continuation and Board callback carry P. FPC refund callback adds a principal argument. Use fresh configuration and balances. Existing ordinary-post/free-like class-qualified gas profiles are disabled; native estimation uses the configured ceiling, including teardown. Re-qualify measured limits for this class rather than reusing old class pins.

The new local library is included in the trusted Rolling provenance allowlist and local Noir manifest inventory. FPC embedded dependency sources were refreshed from its actual compile and checked against the unchanged external package pins; no SDK/version pins change. The deployed build refreshed the raw artifact origin digest and release manifests.

Old standalone balance_of/free-like test harnesses target the superseded contract and need updating if rerun. Compile fixtures were updated for changed ABIs; no acceptance result is inferred from them. Integration acceptance should focus on mixed-note posting, native double-spend rejection, successful paid like, paid-like public revert returning20, posting public revert retaining fee setup, and Bok operator spending a received tip. The completed native development checks do not establish real-proof acceptance, a security audit or production readiness.
