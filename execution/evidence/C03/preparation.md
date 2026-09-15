# C03 implementation preparation

Read-only preparation, 2026-09-15. C02 remains under qualification. No production/source changes, dependency changes, tests or processes were launched. Normative sources: interface-spec.md sections1,5–7 and the four C03 acceptance criteria. No old-board ABI compatibility is required.

## Concrete contract change

- Add production `post_id(board, nonce)` using pinned `poseidon2_hash_with_separator([1, board.to_field(), nonce], 0x42420102)`. Real posts require private fresh nonzero nonce and nonzero derived ID; wallet randomness is an honest-client requirement, not circuit-provable entropy. Add matched SDK/Noir known-answer tests with zero/domain/order/cross-board controls.
- Change private post arguments to `(depositChainId, postNonce, messageFields[32], messageLength:u16, isDummy, child, grandchild)` (the spec's hints pair flattened to existing typed Option arguments is a routine explicit ABI choice). Keep deposit chain and sequence private; real PostNote.post_id becomes the independent Field. No historical post_count read/cast or expected count enters this private path.
- Replace `_post_public(msg,timestamp,post_id,is_dummy)` with only-self `_publish_post(postId,msg,length)`. Enforce nonzero/unused ID and canonical UTF-8/content bounds. Allocate live `postCount:u64` only here, store `postIdByOrder[orderIndex]`, increment once with overflow checking. Use public execution timestamp for publishedAt and checked flagDeadline. Store per-ID content, existence, timestamps and inclusion-time policyVersion. Emit PostPublished V1 with the frozen raw/decoded projection.
- A dummy uses postId0, zero/empty message and declared length0, updates only its private PostNote/deposit transition and does not enqueue publication or increment count. C02 already treats included dummy screening as immediate and ignores dummy flag slots; remove its obsolete public slot expectations in tests.
- Replace public Maps keyed by u32 post index with Field identity. Use nested per-post content/response maps or explicit Poseidon-derived storage keys; do not truncate Field IDs or multiply them into a u32 array index. Add a bounded order getter that resolves public order to stable ID. Keep orderIndex a u64 decimal string at client boundaries.
- Moderate by stable `postId:Field`, not order index: current declare_immoral, is_post_flagged, get_post_flagged_by, response/time/content getters and C02 historical flag lookup all need the same identity. Remove `cn.post_id as u32` and `gn.post_id as u32`. Match expectedPolicyVersion and inclusion-time policy/deadline in the frozen flag interface; if policy implementation is staged, explicitly record that dependency instead of exposing a guessed version in events.

## Cross-consumer migration and required scope amendment

Current C03 source boundary lists only contract/tests/user. The specified event/consumer migration also touches shared schemas/fixtures, generated SDK/apps, moderation CLI and daemon/signer; explicitly add the needed ownership before editing. `shared/protocol-schema.mjs` already expects canonical nonzero Field postId, u64 orderIndex, publishedAt, flagDeadline and policyVersion. It validates structure, not event authenticity.

`apps/src/billboard/user/engine.js`: post and dummy calls around1150/1207 need nonce and byte length. Choose fresh nonce for a new real logical attempt, retain it through ambiguous submission reconciliation, and generate a new one on confirmed collision. Feed loop around1230 currently retrieves by numeric order and uses order as identity; resolve order->ID and keep both. Moderation action around1796/1879 currently accepts postIndex and declares against BigInt(index); replace with validated Field ID plus required policy binding. Update user/app UI/cache keys and CLI flags/output shapes accordingly.

`apps/src/billboard/censor/engine.js` exposes the same old index getters/flag call; verify whether it is a maintained shared consumer or generated copy before edits. `censor-daemon/signer.mjs`, daemon.mjs and signer tests currently freeze/validate `postIndex` as uint32 and invoke `--post-index`; revise the trusted schema/argument array consistently, keeping M01 shell/process isolation protections. Model output still supplies only verdict/reason; it must never choose the target postId.

Existing C01/C02 helpers and tests assume numeric count IDs, seven-field PostNote post_id=count, and dummy public count increments. Update their behavior expectations to the new identity/order semantics while retaining note-authentication/timer assertions. Update generated artifacts centrally with the build manifest, never hand-edit dist. Poseidon post-ID vectors need their own maintained production helper tests; current bridge SHA commitments are unaffected.

## Same-anchor test: supported API boundary

The pinned Noir TestEnvironment does **not** expose an anchor option for contract calls. `CallPrivateOptions` (test_environment.nr267–307) contains scope/utility/gas settings; call_private_opts1137–1173 calls private_call_new_flow and auto-mines. Ten sequential call_private calls are therefore not ten preparations from one anchor. `PrivateContextOptions.at_anchor_block_number` exists, but the private_context documentation near795 explicitly forbids private/public contract calls from that context. Do not patch the oracle or claim a low-level context fixture exercises production post.

Use maintained TXE tests for ten distinct authors with independent authentic claims, stable ID uniqueness, live public order, identity-targeted moderation and duplicate-ID rejection. Keep a baseline historical-counter control if feasible. These are sequential application tests, explicitly not the same-anchor A01 acceptance.

For exact A01, extend the existing actual application fixture with ten fresh funded Aztec accounts and independent receipts, then obtain one canonical eligible header after all rights exist. Synchronize every ephemeral PXE to that same checkpoint and disable autoSync. Prepare/prove all ten production post requests serially, checking each tx.data.constants.anchorBlockHeader byte-for-byte equals the captured header. Submit only after preparation, preserving normal node validation/fees and ordinary sequencer inclusion; assert10 unique nonzero IDs and order indexes0..9 mapping exact content. No private counter value should be an input, and dummy transactions must still work while real posts change the live count. Serial proving avoids resource spikes; it does not weaken the simultaneous-anchor condition.

Whether full setup plus ten genuine proofs fits the unchanged sub-ten-minute budget is unmeasured. First measure the smallest two-author form and reuse the existing fast official settlement fixture. If ten does not fit, report the boundary and split setup/preparation qualification with explicit source/state binding; do not silently extend the deadline, change anchors between authors or turn TXE simulations into claims of ten proofs.

## Conflict and negative controls

- Same DepositNote spent twice remains a legitimate conflict. A dropped/stale conflicting request must cause receipt reconciliation followed by refreshed PXE/note/hints and a new request/proof, or a clear terminal missing-right result. Never resend its stale proof blindly.
- Current user engine submitRetry around359 resends the same tx for TRANSIENT_RE and treats broad existing-nullifier errors as possible submission. Add a controlled behavioral test distinguishing exact already-known tx from a different tx spending the same note; verify no stale submit loop and actual reproving/refetch on recoverable conflict. User rejection retry is a separate path.
- Duplicate/zero ID and public-only-self violations reject. Moderation using order as if it were identity must not flag another post. Out-of-range order and unknown ID reject; count overflow does not publish partial state.
- Two preparations with independently chosen nonce and rights from one anchor must succeed despite changed count. Two spends of one right must not both create successors. Dummy screening must not read/reserve a public counter, publish content or be delayed solely by unrelated public posts.
- Keep C03 claims narrow: note-history discovery limits remain C04; complete penalty/finite-exit and final public deadline behavior remain C05; real public-revert rollback belongs to the declared integration boundary and must not be inferred solely from ABI design.

Source `execution/interface-spec.md` SHA-256 `13824f7d093ea6c5b460c771609b4188e4770fd0af834cfc8b372cb4ef0c12c1`.

Source `billboard/billboard_contract/src/main.nr` SHA-256 `3b97859fe3f694410a0155743e6c25b2eaf286ee0e40cc2a1fe494cc72b7cab1`.

Source `apps/src/billboard/user/engine.js` SHA-256 `5442594ec55a93fa176e53cf1945dabf18ec57799d641cfdac441c05ddd26284`.

Source `shared/protocol-schema.mjs` SHA-256 `996ad92705b563cea6a4972d475f4600a8acb5ab92801671f50fda6c4cdfe4b2`.

Source `censor-daemon/signer.mjs` SHA-256 `251e856ce7f8152ae453af6fb3edf1d8bf79ee8b2c35950c03b226da83e4657a`.

Source `/Users/zac/nargo/github.com/AztecProtocol/aztec-nr/v5.2.0/aztec/src/test/helpers/test_environment.nr` SHA-256 `820462b8b57d9a4d052613990f6535b1591e285b8443914db5798554bdaef2df`.
