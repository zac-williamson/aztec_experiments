# W01 production interface review

2026-09-15. Bounded source review after C03 commit `3f04186`; no implementation, build, proof or transaction in this lane. This recommends the next production interface, not W01 acceptance. The prior two-coupon fixture remains feasibility evidence with its recorded proof profile.

## Recommendation: separate sponsor, exact owner authorization

Use a separate restricted sponsor with an immutable board target and fixed delegated operation selectors. The board does **not** need a sponsor allowlist, additional administrator or sponsor configuration. Each delegated call must unconditionally authenticate its explicit owner with the pinned private current-call authwit helper. That authorization binds the actual caller, board consumer, network scope, selector and all serialized arguments. A second delegator explicitly authorized by the owner is safe at this ownership boundary; an authorization issued for the reviewed sponsor cannot be reused by a different caller.

The fixture's `only configured sponsor` check restricts its demonstrated topology; it is not necessary for owner authorization once the unconditional exact-call check and owner-scoped body are present. Removing that restriction does not authorize arbitrary callers to debit the restricted sponsor: its own root controls remain mandatory. This recommendation supersedes the earlier suggestion to add immutable sponsor storage to the board.

An integrated board sponsor root can also constrain one operation, but would couple funding, coupon policy and budget management to board storage and deployment. The separate contract reuses the qualified root pattern and avoids changing C01 constructor/config/portal commitments. Neither choice removes the need to qualify actual production coupon rotation and replenishment.

## Narrow fresh ABI and implementation boundary

Recommended private board entrypoints (existing current C03 argument types retained):

```text
delegated_claim_deposit(owner: AztecAddress, depositor: EthAddress,
  amount: u128, deposit_nonce: u64, secret: Field,
  message_leaf_index: Field, auth_nonce: Field)
delegated_post(owner: AztecAddress, deposit_chain_id: Field,
  post_nonce: Field, msg: [Field;32], message_length: u16,
  is_dummy: bool, child: Option<HintedNote<PostNote>>,
  grandchild: Option<HintedNote<PostNote>>, auth_nonce: Field)
delegated_withdraw(owner: AztecAddress, deposit_chain_id: Field,
  auth_nonce: Field)
```

Require nonzero owner and a fresh nonzero user-held `auth_nonce`; call `assert_current_call_valid_authwit` unconditionally before the shared body. Its generic `N` is the sum of **serialized field lengths**, not the top-level parameter count: use the pinned macro's `Serialize::N` type-sum pattern and verify the generated ABI. In particular, hints and arrays are not single fields. The `authorize_once` macro has a deliberate self-caller shortcut; either call the helper directly or explicitly make that shortcut incapable of successful execution, as in the reviewed delta below.

Refactor direct and delegated routes into common internal bodies taking an authenticated owner. Direct routes pass `msg_sender`; delegated routes pass only the authenticated explicit owner. Current claim/post/withdraw read `msg_sender` for note ownership. Simply calling the old external method from a sponsor would operate as the sponsor. Replace that dependence consistently for Owned-note access, chain derivation, note delivery, screening scope and link construction. Claim retains the exact portal message/secret/index checks; withdrawal retains the note's L1 depositor and amount/receipt nonce, with no caller-chosen refund recipient. Public publication remains only-self and exposes neither owner nor deposit chain.

Keep `auth_nonce` separate from `post_nonce`: real logical post identity must remain stable across state refresh/reproof; dummies require post nonce zero. Changed hints require a newly matching authwit. A fresh private authorization nonce also prevents the issuer from computing an authwit nullifier from otherwise known action data. Do not transmit the full private authorization preimage to an issuer or logs.

## Sponsor and client requirements

Provide fixed root entrypoints for claim/post/withdraw (or a closed operation enum with static dispatch), with no caller-selected target, selector, call list, account relay or callback. Each requires absent private caller, validates finite owner-bound coupon membership and actual transaction gas/expiry bounds, consumes the owner-bound SingleUseClaim before phase transition, elects the sponsor payer, ends setup, and invokes exactly one approved board operation. Coupon owner and delegated owner must agree. The account authwit verification is a static private call in pinned5.2; it cannot use that callback to change state. Reviewed board code must likewise expose no arbitrary forwarding path from these methods.

Use the actual NO_FROM/DefaultEntrypoint path retaining auth witnesses and scopes. The existing fixture's wallet `createAuthWit(owner,{caller:sponsor,call:delegatedCall})` is the concrete model. An appended fee hook inside an arbitrary account transaction does not establish the root restriction. Check final gas settings after estimation against coupon caps, and fail closed on unavailable, exhausted, invalid or unsupported sponsorship. Preserve original user intent during retry; do not silently fund or select an author FeeJuice payer.

Sponsorship must cover claim, real/dummy post and exit. Sponsoring only posts while requiring publicly funded reusable author accounts for claim/withdraw recreates a funding link. The existing L1 deposit/refund is public by design; keep its private association with the Aztec owner/chain out of public fee data. Issuer input should be an opaque user-created leaf commitment; owner and blinding entropy remain local. SingleUseClaim hides its spend relation using the owner's nullifier-hiding key, but the complete transaction's other nullifiers, fee values, timing, RPC requests and coupon batches still require observation review. Genesis funding proves no replenishment privacy. Shared sponsor funding and privacy-aware metrics remain W01 production work.

## Smallest discriminating qualification

1. Compile and test shared direct/delegated state equivalence, claim chain ownership and recorded refund recipient. Reject wrong owner, wrong caller, altered selector/arguments/hints and reused authwit. Include a deliberate second authorized delegator success control to establish the no-allowlist policy.
2. Exercise sponsor nesting, mismatched coupon/delegated owner, wrong operation/target, coupon replay, every gas/expiry boundary and exhausted budget. Preserve paid public-revert coupon/fee accounting. Test batch rotation and aggregate authorization limits; two-ticket one-time configuration is not production rotation.
3. Run the actual application journey with genuine private transaction proofs and normal node validation, official controlled local Outbox settlement, and zero author FeeJuice throughout. Inspect actual fee payer/debits, claim/post/exit effects and no-fallback behavior. Stay within the user's under-ten-minute application-test boundary; no network prover is needed.
4. Record public transaction effects and bounded issuer/RPC/operator observations, including authorization-nullifier preimage knowledge and actual shared funding route. No claimed anonymity from merely hiding a JS address field; no new per-author telemetry identifier.

C04 screening-history discovery and C05 final policy/deadline/economic integration remain staged. Do not invent a current policy version as part of this fee ABI. W01 remains incomplete until its four acceptance criteria have integrated evidence.

## Source binding

Pinned source inspected: `aztec/src/authwit/auth.nr` (current-call binding/static verification/nullifier), `macros/internals_functions_generation/external/helpers.nr` (serialized argument length), fixture sponsor/application/common, current board, and prior W01 preparation. These are local pinned implementation facts; this note makes no new claim about current public network availability or upstream endorsement.

- `billboard/billboard_contract/src/main.nr`: `b9a384f40339c8cde664177f832d709c3509c59ac6e94ba84b1c5f76e382fd32`
- `billboard/fee-fixture/sponsor/src/main.nr`: `969a96ff9f47125a16c1a09008ca32344e31ae97de7b265e5ac56edcce3899fb`
- `billboard/fee-fixture/application/src/main.nr`: `23b13163e57bb6d2e2131151d6e0287fc1c80c710806ff50476cf6ad988ad070`
- `billboard/fee-fixture/common/src/lib.nr`: `05bf7abe137977adf54668077741adbf2723b0ea9c8d6543de5d21fc54092ba9`
- `execution/tasks/W01.md`: `50af669a731254afe5831f521bc6d04bbf5ae92817daf6e92c677a23be352677`
- `/Users/zac/nargo/github.com/AztecProtocol/aztec-nr/v5.2.0/aztec/src/authwit/auth.nr`: `7194b1ee12dca5d7ff0e02141817a985fcbaa90124aa606b62f1cf23c657cba0`
- `/Users/zac/nargo/github.com/AztecProtocol/aztec-nr/v5.2.0/aztec/src/macros/internals_functions_generation/external/helpers.nr`: `34c8c5014826d0a10e40f49c74e55021308e5b7e820279d989c78d37ae290b92`

## Applied board-only delta disposition

Root subsequently implemented only the three delegated wrappers and shared private internal bodies. Reviewed the actual diff read-only: `#[authorize_once("owner", "auth_nonce")]` precedes `#[external("private")]`, as required by the pinned macro. Each delegated body asserts owner differs from caller and auth nonce is nonzero. Therefore its self-caller branch cannot produce a successful call, and every successful delegated operation necessarily executes the exact owner authwit check. This is a valid alternative to the proposed direct unconditional helper call and avoids manually specifying the serialized hint length. The macro's self-caller nonce error can occur before the explicit owner-difference guard; negative tests must respect actual ordering.

The original operation bodies were moved to `_claim_deposit_for`, `_post_for` and `_withdraw_for`, retaining their explicit sender parameter. Direct entrypoints pass their caller; delegated entrypoints pass the authenticated owner. The inspected diff introduces no further economic, portal, identity, publication or screening changes, and does not add a sponsor allowlist. Claim already rejects zero owner; post/withdraw require an actual owner-scoped note. An explicit zero-owner guard on all wrappers remains a useful interface invariant but no zero-owner spending bypass is established by this review.

No concrete blocker found in this narrow source refactor. This is source review, not compiler or proof qualification: the root is compiling, and real authwit, caller/argument substitution, shared-state and replay controls remain required before acceptance. Sponsor/client/funding implementation is still separate.

Applied main.nr SHA-256: `b9a384f40339c8cde664177f832d709c3509c59ac6e94ba84b1c5f76e382fd32`.
