# P04 contract interface design lane

## Delivered design and status

`execution/interface-spec.md` defines the fresh-deployment Billboard V1 contract boundary. It is a specification for implementation in C01–C06, not evidence those contracts are already repaired. The user clarified that no board is deployed; backward ABI/state compatibility and old-board migration paths are excluded. The earlier compatibility-preparation record remains historical; its package/protocol compatibility work is still needed, while references to existing application state must be interpreted in light of this newer fresh-deployment instruction.

This lane modified only the interface specification and this evidence note. It read P01's product specification, requirements/decisions, P04 acceptance, current Solidity/Noir and verified upstream V5.2 API source. No application code, package lock, graph, deployment or transaction was changed. Root owns the service schemas/executable fixtures and performs integration acceptance.

## Concrete decisions

- Public identity is a fresh per-post Field commitment, independent of account/depositor/deposit ancestry. Public u64 order is assigned in live public execution, never reserved by a historical private counter read.
- The L1 receipt includes a persistent per-depositor u64 nonce. Claim and exit content use distinct application domains and a fixed 288-byte transcript binding network, portal, board, rollup version, depositor, nonce and amount. Protocol bridge envelopes/nullifiers remain mandatory.
- Deposits are disabled until a real authenticated L2 ready message confirms the one-time actual portal binding and immutable configuration commitment. Relaying activation is permissionless; there is no admin bypass, sweep or timeout refund.
- One private DepositNote holds the per-deposit right and sequence/debt state. PostNotes bind private chain identity, sequence, immediate previous link and independent public ID. All hinted-note contract, owner and owned slot bindings are constrained alongside actual historical inclusion.
- The hint adapter selects exact private chain/sequence before applying a bounded query result limit. That is a proposed implementation using verified typed selector/oracle APIs, not a claim that the current fixed-16 helper is repaired. The wallet retains/rebuilds a private index across bounded recovery pages; no private identifier enters public feed records.
- Real-post screening uses actual public publication/deadline values authenticated at the anchor. Flags close strictly at the deadline; screening starts at or after it. This prevents delayed private proofs receiving a shortened censor window and prevents a newly included late flag changing already-mature historical status.
- Policy content has an exact byte-level commitment. Each post captures its policy version at actual public inclusion; the current authorized censor flags against that historical content/version. Replacing a policy does not retroactively change prior posts' rules. Root explicitly agreed and included this policyVersion in service event planning.
- Checked economic bounds preserve P01's ceiling cooldown, M-not-M+1 burst rule and expired debt for every withdrawal. Burning the right and emitting the exact exit message precede authenticated refund; prior nonce/history cannot apply to a later deposit.

## Coordination with root

Agreed shared types: `schemaVersion=1`, lowercase canonical Field hex postId, decimal-string u64 orderIndex, network scope with distinct decimal l1ChainId and u32 rollupVersion, L1 rollup/portal addresses and board Field. Root's jobs bind network scope, postId, policyVersion and a composite modelVersion covering runtime image/weights/prompt/settings. Root's receipt design keeps lifecycle/finality separate from execution success and does not complete nonpending/reverted/dropped outcomes.

Agreed commitment domains: `AZTEC_BB_CLAIM_V1`, `AZTEC_BB_EXIT_V1`, `AZTEC_BB_READY_V1`, `AZTEC_BB_CONFIG_V1` and `AZTEC_BB_POLICY_V1`, ASCII right-padded to 32 bytes. Policy hashes append exact UTF-8 bytes after domain/schema/board/length words; claim/exit and readiness use only fixed words. The specification explicitly describes SHA256-to-Field truncation to prevent an incompatible modulo-based implementation.

Root accepted the authenticated ready design subject to actual bridge API verification and retained the no-new-admin-custody constraint. Public events contain no depositor, private owner, deposit nonce, private chain ID, sequence or link. Network l1ChainId remains public scope; it is not the private depositChainId.

## Verified existing primitive support

Read-only requests inspected official tagged V5.2.0 source at `AztecProtocol/aztec-packages` (the release resolves to commit `49a592109ec4f18d79212b43d621891aaf36f7b6`). Relevant observed APIs:

- Private `consume_l1_to_l2_message(content, secret:[Field;N], sender:EthAddress, leaf_index:Field)` authenticates against the anchor's L1-to-L2 tree and execution context. `message_portal(recipient, content)`, `chain_id()`, `version()` and `request_nhk_app()` exist. [Official private context source](https://raw.githubusercontent.com/AztecProtocol/aztec-packages/v5.2.0/noir-projects/aztec-nr/aztec/src/context/private_context.nr).
- Public `timestamp()`, `chain_id()`, `version()` and `message_portal(recipient, content)` are actual AVM-backed context methods. [Official public context source](https://raw.githubusercontent.com/AztecProtocol/aztec-packages/v5.2.0/noir-projects/aztec-nr/aztec/src/context/public_context.nr).
- Getter/viewer options accept typed `PropertySelector<T>` values with Packable constraints, owner scoping and offset/limit controls. [Official getter options](https://raw.githubusercontent.com/AztecProtocol/aztec-packages/v5.2.0/noir-projects/aztec-nr/aztec/src/note/note_getter_options.nr), [official viewer options](https://raw.githubusercontent.com/AztecProtocol/aztec-packages/v5.2.0/noir-projects/aztec-nr/aztec/src/note/note_viewer_options.nr).
- `assert_note_existed_by` computes a note hash from hinted owner/slot/randomness, silos using hinted contract address, and verifies membership. It does not itself require this application's intended contract/owner/slot/deposit chain. The explicit bindings in the design are still necessary. [Official note history source](https://raw.githubusercontent.com/AztecProtocol/aztec-packages/v5.2.0/noir-projects/aztec-nr/aztec/src/history/note.nr).
- Local pinned Solidity `Hash.sha256ToField(bytes)` truncates to the first 31 digest bytes and prepends a zero byte. Existing local Noir uses its protocol counterpart. Cross-language V1 known-answer vectors are required; this read-only observation alone does not supply them.

No unsupported proof of absence, private public-counter reservation, author-revealing onchain history index, model attestation or unilateral cross-chain refund is assumed.

## Remaining validation and design risks

1. Independent byte/hash fixture agreement is complete for the frozen seven CONFIG/READY/CLAIM/EXIT/policy cases and shared service identity/failure records. Actual production consumer wiring, domain-separated Poseidon ID vectors and authenticated bridge/proof integration remain implementation tests in the designated downstream packages; pure interface fixtures do not satisfy them.
2. Actual matched Noir beta25/Aztec 5.2 note packing and selector construction are verified: the other agent's maintained fixture passes 15/15 pure layout/range tests, covering DepositNote 11 Fields, PostNote 7 Fields, every generated selector and scalar boundary round trips. I read the fixture and its saved result. Selectors use ordinal field index, byte offset 0 and byte length 32. The spec now freezes those exact values. Actual raw u32/u64/u128 unpack casts truncate over-width Fields and raw EthAddress unpacking does not itself check 160-bit range. The spec requires canonical pack/unpack roundtrip validation where raw Fields are actually present and explicit address validation. Typed HintedNote acceptance instead requires authenticated canonical note-hash membership and all explicit application bindings; the spec does not invent raw witness access after deserialization. The 15-test saved result includes known raw behavior, failing malformed-roundtrip controls and canonical normal controls. The earlier wrong range expectations are retained in note-layout-range-probe.log as discovery history, not presented as passing rejection tests. This is not oracle, PXE/TXE retrieval or proof evidence; the HintedNote adapter and actual query behavior remain C02/C04 acceptance work.
3. The readiness, claim and exit flows require actual protocol proof/message tests. Permissive Outbox fixtures only test accounting and cannot establish readiness/authentication.
4. Post note replacement/public publication and exit-right burn/message emission must be tested for actual application revertibility. A public execution revert must not leave a usable partial state.
5. Public storage/write/event/gas limits, 1000-note local query performance and ten-author progress must be measured. The proposed interfaces do not claim current performance.
6. The policy freeze-at-inclusion and public deadline checks deliberately replace ambiguous historical timing. C05/M02 must test policy changes, censor rotation, stale jobs, boundary timestamps and delayed inclusion together.
7. Application hardening cannot establish protocol soundness. X03's current deployment pause remains a separate release constraint; no network retarget or waiver is implied.

## Independent service-fixture review

Reviewed `shared/protocol-schema.mjs`, `shared/protocol-commitments.mjs`, `scripts/test-protocol-schema.mjs` and `execution/interface-fixtures/service-v1.json` against the contract design. Findings sent to root concerned u64 L1-chain bounds, positive u32 censor windows, supported timestamp horizon, nonzero real-post/censor IDs, nonempty policy, NUL handling, and exact job/post deadline agreement. Root fixed the validator/test differences; the specification now explicitly prohibits U+0000 and maps raw packed contract events to decoded service envelopes. The encoder's five domain labels, word order, word lengths and SHA truncation agree with the specification on source review.

Independent actual command from repository root:

```text
/Users/zac/.nvm/versions/node/v24.15.0/bin/node --test scripts/test-protocol-schema.mjs
```

Result on 2026-09-12 UTC: 18 tests, 18 pass, 0 fail, 0 skipped. This includes actual matched SDK receipt classes, canonical serialization/scope checks, independent post identity/public order fields and failure/finality distinctions. The tests exercise imported validators rather than matching source substrings. Shape validation and synthetic positions do not authenticate chain events, prove concurrency, establish current consumer migration, or complete real-chain requirements.

Final JavaScript commitment follow-up: reran the same command with `scripts/test-protocol-commitments.mjs` added: 27/27 combined tests pass, 0 fail, 0 skipped. The seven known-answer vectors construct independent ethers ABI preimages and invoke the actual SDK `sha256ToField`, as well as the WebCrypto-based encoder. I independently reconstructed every preimage with Python standard-library 32-byte big-endian integers/right-padded ASCII domains and checked hashlib SHA-256 first-31-byte truncation. Config/ready/claim/exit/boundary/policy/Unicode lengths are respectively 384/224/288/288/288/136/147 bytes. All bytes/hashes match the specification. The service policy text and board address now produce the policy hash used by all related events/job.

Read `scripts/fixtures/solidity-interface-v1/test/ProtocolCommitmentVectors.t.sol` and `execution/evidence/P04/solidity-commitment-tests.log`: 7/7 actual Solidity tests pass with solc 0.8.27. These construct each preimage from typed scalars and invoke the pinned protocol Hash library; this reviewer did not separately rerun Foundry. Requested maintained frozen-vector agreement checks and a service-policy cross-fixture assertion so future drift fails. Root added the policy assertion; a final independent rerun passes 28/28 combined JavaScript tests, 0 fail, 0 skipped. The final Noir result passes 22/22 (15 layout/range/selector checks plus seven commitment construction/hash checks). I read its independent scalar/domain construction and actual protocol hash invocation, and verified every logged fixture hash and vector fingerprint against current bytes. The runner rejects a changed JSON vector file and verifies all six locked source packages / 413 files before and after execution. I did not rerun the Noir compiler in this review lane. Cross-language interface agreement is accepted for these exact fixtures; future production implementations must consume/test them rather than claiming these isolated fixtures repair application behavior. These are pure interface computations, not bridge-authentication or proof tests.

## Final integration follow-up

Reviewed the final pre-portal configuration encoder and service specification. The encoder requires exactly the four configuration scope fields before the portal exists, while Ready still requires the actual deployed portal; the frozen commitment bytes are unchanged. The public cursor now carries block number, transaction index within block and log index within transaction. The exact modelVersion transcript is defined in the service specification. These changes were independently exercised in the isolated native copy: final schema/commitment tests pass 33/33. The isolated Solidity runner also passes 7/7 and now rejects a changed frozen JSON vector fingerprint. See `clean-native-review.md` for final build/CI review, source-copy deltas and explicitly retained failed integration attempts.

## Current reviewed source fingerprints

- `execution/interface-spec.md`: SHA-256 `e3ed67c6cba40ba481fa40e691b0b79c8c3462fdc4c50ff03173d665e334be57`.
- `shared/protocol-schema.mjs`: SHA-256 `996ad92705b563cea6a4972d475f4600a8acb5ab92801671f50fda6c4cdfe4b2`.
- `shared/protocol-commitments.mjs`: SHA-256 `2a6e2221f769bff7aa98e61600d40e03faeca8d191aaa361aa473789096f2c66`.
- `scripts/test-protocol-schema.mjs`: SHA-256 `e270d3f326330daea5be267b822c1dcded6b02f14ab01e20962bddd5f50817d4`.
- `scripts/test-protocol-commitments.mjs`: SHA-256 `078864a0a506344337526413128217ff4f8cf3b5e7eb1513b3f3b7019129db9d`.
- `scripts/generate-protocol-vectors.mjs`: SHA-256 `b370c454b9c4309304b37e365a3b2511bb780cd20ec0dbf92c39542792745fca`.
- `execution/interface-fixtures/service-v1.json`: SHA-256 `227e07da682a7fac808d9d5e509eca5654b2870a77a453458d9a8a30407de77a`.
- `execution/interface-fixtures/commitments-v1.json`: SHA-256 `e988b16a0bc12fc2ab6423b429cd7485f1b5174fc4ed09915314b6e6ce1f9b92`.
- `scripts/fixtures/noir-interface-v1/src/lib.nr`: SHA-256 `f2bfb1fcd27c20c2f61bf6cc366ea0995c8cca6ec4edc632be5fd5b2e25c0e83`.
- `scripts/fixtures/noir-interface-v1/src/commitment_vectors.nr`: SHA-256 `10d9c91f67ede4e565ac6e080ee72d2f4922df5e9666a51272ce16d6811b9b45`.
- `scripts/fixtures/noir-interface-v1/run.mjs`: SHA-256 `f42bb3dd746a333e9ebe67abb9f906e1ec635ec64c645795d80b6ca585c6d153`.
- `execution/evidence/P04/note-layout-tests.log`: SHA-256 `76a1df018bec100d8f3912d700802049eddb1463b2fee8029c2ac4766e2548e7`.
- `scripts/fixtures/solidity-interface-v1/test/ProtocolCommitmentVectors.t.sol`: SHA-256 `5a2a228afbdeb85653dd781e03a64dbda77246e89898b866115f46defd57ce34`.
- `scripts/fixtures/solidity-interface-v1/foundry.toml`: SHA-256 `0b63d94bce719bc8f554e4ffcdb4c5770a66f1e550a36d0334ee8c14e31ac0a3`.
- `execution/evidence/P04/solidity-commitment-tests.log`: SHA-256 `0854ca2d89dc59dde9ddfa4ad14658410b2162a477520a40b7ba41dbd318bc80`.

Any later coordinated revision requires affected fixture review against the updated bytes; this is not final-source release evidence.
