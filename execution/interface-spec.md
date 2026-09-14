# Billboard V1 contract interfaces

P04 design, 2026-09-12 UTC. **Normative implementation target, not a description of completed contract fixes.** The user confirmed that no message-board versions are deployed: this specification targets a fresh deployment only. It has no legacy ABI compatibility, old-board state conversion or upgrade bridge. Historical bad artifacts remain test fixtures. The required Aztec V5 protocol compatibility and recovery of the new wallet's own state remain in scope. X03 network clearance is separate.

The source of product semantics remains `execution/product-spec.md`. Implement changes in the ordered C01–C06 contract chain and update all consumers against the same V1 fixtures. Root's service schemas define receipt, feed, fee and moderation records; this document defines the contract identifiers and commitments they use.

## 1. Wire types and hashing

All cross-consumer records use `schemaVersion: 1`. Reject unknown versions and fields at authority boundaries. Canonical integer JSON values are base-10 strings without signs, whitespace or leading zeros except `"0"`; never route u64/u128 amounts through a JavaScript Number. A Field is lowercase `0x` plus exactly 64 hexadecimal digits, less than the matched SDK's Fr modulus. L1 addresses are lowercase `0x` plus exactly 40 hexadecimal digits; zero is rejected where an actor is required. Aztec addresses use the Field encoding. SHA-256 digests are lowercase `0x` plus 64 hexadecimal digits and are not assumed to be Fields.

Public network scope is `{l1ChainId:u64, rollupAddress:EthAddress, rollupVersion:u32, boardAddress:AztecAddress, portalAddress:EthAddress}`. L1 chain ID and rollup version are distinct. Scope is validated against both configured contracts and live deployment preflight. The private identifier is named `depositChainId`, never the ambiguous `chainId`.

`word(x)` means exactly 32 bytes in big-endian order, left padded with zero bytes. Range-check x before encoding; a Field has its canonical 32-byte representation. `domain(s)` is the literal ASCII bytes of s, right padded with zero bytes to 32 bytes. There are no ABI function selectors, dynamic offsets, UTF-8 normalization or implicit string terminators in the commitments below.

`SHA_FIELD(bytes)` is Aztec's `sha256ToField` / `sha256_to_field`: take the first 31 bytes of SHA-256 and prepend `0x00`. Equivalently, shift the 256-bit digest right by 8. It is **not** reduction modulo Fr or deletion of the first byte. C01 must have matching Solidity, Noir and JavaScript vectors, including leading-zero and boundary integers.

Application Poseidon2 uses the supported `poseidon2_hash_with_separator` with these reserved u32 separators:

| Purpose | Separator | Ordered Field inputs |
| --- | --- | --- |
| Private deposit ancestry | `0x42420101` | `[1, boardAddress, owner, claimContent, claimSecret]` |
| Independent public post ID | `0x42420102` | `[1, boardAddress, postNonce]` |
| Private post link | `0x42420103` | `[1, boardAddress, owner, depositChainId, sequence, innerNoteHash, linkSecret]` |

These are application-local domains, not replacements for Aztec's note/message/nullifier domains. Reuse of a separator for another preimage schema is forbidden. Derive and test constants/known-answer vectors with the matched SDK and Noir; no hand-written cryptographic implementation is introduced.

## 2. Immutable configuration and activation

The board initializes one time with a nonzero deployer, censor, initial policy and bounded economic parameters. The following remain immutable for this deployment: network scope except the initially unset portal, minimum/maximum deposit, base cooldown, multiplier, censor window and saved-post limit. Censor transfer and policy publication are separately authorized mutable operations. A new economic configuration requires a fresh deployment; there is no administrator sweep or migration of live rights.

Configuration types/bounds:

| Name | Type and valid range |
| --- | --- |
| `minDeposit`, `maxDeposit` | u128, `1 <= minDeposit <= maxDeposit <= 2^96-1` wei |
| `baseCooldown` | u32, `1..2^32-1` seconds |
| `kMultiplier` | u16, `1..65535` |
| `censorWindow` | u32, `1..2^32-1` seconds |
| `maxSaveUp` | u16, `1..65535` |
| Runtime timestamps | u64, supported values at most `2^63-1` seconds |

These defensive bounds permit wide u128 intermediate arithmetic without unsupported larger integer primitives. They are not production policy defaults. Both sides validate their applicable bounds before accepting collateral.

The immutable configuration commitment is:

```text
configHash = SHA_FIELD(
  domain("AZTEC_BB_CONFIG_V1") || word(1) ||
  word(l1ChainId) || word(rollupAddress) || word(boardAddress) || word(rollupVersion) ||
  word(minDeposit) || word(maxDeposit) || word(baseCooldown) ||
  word(kMultiplier) || word(censorWindow) || word(maxSaveUp)
)
```

This is 12 words / 384 bytes. The board address is its actual deployed address. The portal constructor receives that board, the verified rollup, minimum/maximum and the same expected configuration commitment. It begins with `depositsEnabled=false`. `configHash` excludes the portal address to avoid a circular CREATE-address requirement; the activation message below binds the actual portal address.

Only the original board deployer can request one-time portal binding. The public binding function is `only_self`, rejects zero/previous binding, writes the actual portal and emits one L2→L1 ready message using supported `message_portal`:

```text
readyContent = SHA_FIELD(
  domain("AZTEC_BB_READY_V1") || word(1) || word(l1ChainId) ||
  word(portalAddress) || word(boardAddress) || word(rollupVersion) || word(configHash)
)
```

This is 7 words / 224 bytes. Any relayer may call the portal's `activate(epoch, checkpointCount, leafIndex, path)` with an actual finalized Outbox proof. The portal constructs the expected message from its immutable fields, authenticates the sender `{boardAddress, rollupVersion}` and recipient `{this, block.chainid}` through the canonical Outbox, and enables deposits exactly once. It has no administrator shortcut. Outbox rejection reverts activation. The portal must reject `deposit` while disabled. D01 verifies actual code/actors and C01/C06 prove this readiness round trip; a mock bridge does not satisfy that requirement.

## 3. Escrow receipts and claim/exit messages

The portal maintains `lastDepositNonce[depositor]:u64` and `activeDeposit[depositor]:{nonce:u64, amount:u128}` plus `totalDeposited:u256`. Nonce zero means no active receipt. The first successful deposit receives nonce 1; increment once for each successful new deposit and retain the counter after refund. Reject nonce overflow. One active receipt per depositor remains enforced. Reject ordinary unsolicited ETH; forced ETH is surplus, never credited to liabilities.

For either claim or exit use this exact 9-word / 288-byte layout:

```text
content = SHA_FIELD(
  domain(messageDomain) || word(1) || word(l1ChainId) || word(portalAddress) ||
  word(boardAddress) || word(rollupVersion) || word(depositor) ||
  word(depositNonce) || word(amount)
)
messageDomain = "AZTEC_BB_CLAIM_V1" or "AZTEC_BB_EXIT_V1"
```

The L1 claim event may expose depositor, nonce, amount, message key/leaf index and claim secret hash because these are already L1 escrow data. It must never expose the claim secret, author, private note, private link or `depositChainId`. The wallet generates a fresh nonzero private claimSecret with cryptographic randomness; the private claim rejects zero. The claim secret hash remains the **protocol** `compute_secret_hash([claimSecret])`, passed through the Inbox's secret-hash field; it is not an application replacement for message authentication.

The private board entrypoint is logically:

```text
claim_deposit(depositor:EthAddress, amount:u128, depositNonce:u64,
              claimSecret:Field, messageLeafIndex:Field)
```

There is no caller-chosen portal/board/version override. Read the one-time stored portal and immutable configuration through authenticated historical storage at the anchor; assert binding is complete, all actors nonzero, amount/nonce valid and execution context chain/version match configuration. Construct claimContent and invoke the actual private `consume_l1_to_l2_message(claimContent, [claimSecret], storedPortal, messageLeafIndex)`. Protocol consumption must authenticate its envelope and produce the single-use nullifier. Compute the private `depositChainId` using the table above, require nonzero, and create one owned DepositNote. Knowledge of the claim secret authorizes choosing the recipient author; the refund recipient remains the original L1 depositor.

An exit message carries the same public receipt tuple under the distinct exit domain. The portal reads amount and nonce from the caller's active receipt; it does not trust caller-supplied amount/nonce. Under a reentrancy guard, clear the active liability and decrement the total before external bridge/ETH calls, consume the expected authenticated Outbox message, then transfer exactly that amount to the original depositor. Any bridge or transfer failure rolls back all effects. Old exit proofs cannot release a later nonce. No timeout refund, discretionary withdrawal or administrator fund transfer exists.

## 4. Private note schema and transitions

Only V1 notes are accepted. `owner` is the authenticated caller of the private entrypoint and is part of the owned state-variable/note metadata. The application must not accept an untrusted owner parameter as authority.

DepositNote V1 logical serialization order is:

```text
[schemaVersion:u32, depositChainId:Field, depositNonce:u64, amount:u128,
 l1Depositor:EthAddress, headLink:Field, headSequence:u64,
 screenedLink:Field, screenedSequence:u64, lastRealSequence:u64,
 nextAllowedTime:u64]
```

PostNote V1 logical serialization order is:

```text
[schemaVersion:u32, depositChainId:Field, sequence:u64, postId:Field,
 anchorTimestamp:u64, previousLink:Field, isDummy:bool]
```

The arrays above define the **logical wallet serialization**, not the physical note storage. A September 14 C01 full compilation exposed that the earlier P04 pure packing fixture did not call NoteType.get_id/create_note: Aztec 5.2 enforces a maximum of eight packed fields only when actual note creation/discovery is instantiated. The earlier eleven-field physical layout is superseded; the failed build and original specification paragraph are preserved in C01 evidence. No dependency or protocol limit is modified.

DepositNote physical storage is exactly eight Fields, in this order:

```text
[receiptMetadata, depositChainId, amount, l1Depositor,
 headLink, screenedLink, sequenceState, nextAllowedTime]
receiptMetadata = schemaVersion + depositNonce * 2^32          // 96 bits
sequenceState = headSequence + screenedSequence * 2^64 + lastRealSequence * 2^128 // 192 bits
```

ReceiptMetadata and SequenceState are typed local structs with one-field canonical Packable implementations. Their unpackers must require repacking equality with the original Field, rejecting unused upper bits and preventing truncation aliases. DepositNote itself uses derive(Packable), so generated typed selectors follow its actual field layout: depositChainId index1, amount2, l1Depositor3, headLink4, screenedLink5, sequenceState6, nextAllowedTime7. These whole-Field selectors have offset0/length32; no partial selector or manual macro override is introduced. Receipt nonce/schema and individual sequences are validated after decoding, not queried with a fictitious whole-Field selector. get_deposit_info returns the unchanged eleven logical Fields explicitly, not note.pack().

PostNote remains seven Fields in the listed order, with generated depositChainId index1 and sequence index2, offset0/length32. Note types derive the matched note traits. Arbitrary-origin EthAddress must validate its 160-bit bound. Other raw integer unpackers may truncate, so application raw boundaries require canonical repack equality in addition to schema/economic bounds. Typed HintedNote membership authenticates the hash of the canonical typed note, with owner/slot/contract/ancestry checks in C02; no unavailable raw witness API is assumed. C01-A05 now requires actual creation/delivery/retrieval/nullification and over-width controls. P04's prior pure packing results remain historical evidence for that fixture, not support for storing an eleven-field note.

On claim, head/screened links and all sequence counters are zero. `nextAllowedTime=claimAnchorTime+cooldown`. Each post consumes exactly one live owned DepositNote selected by `depositChainId`, explicitly checks its schema/identity after selection, and creates exactly one replacement. No transfer or arbitrary mint helper is exposed. Protocol nullification prevents competing transactions spending the same right. Uniqueness is established by authentic one-time claim and one-for-one transitions, not by an oracle's claim that its query returned only one note.

Sequence starts at 1 and increments by one per private chain entry, including dummies; reject overflow. The new PostNote links to old head. Obtain actual inserted-note randomness/metadata, compute the standard inner note hash, then compute the private link from the domain table. `linkSecret` is the authenticated owner's application-siloed NHK obtained through the supported context key request. Preserve note delivery through the supported constrained mechanism. Neither the secret nor private links/sequence/chain ID enter public calldata or events.

Public and private effects of a real post must belong to the same application revertibility boundary. A rejected public publication must not consume the old right, create a usable successor, or charge an application success. T02/W03 must demonstrate actual protocol behavior here; interface design does not establish it.

## 5. Independent post identity and public ordering

For every real post the wallet chooses a fresh nonzero cryptographically generated private `postNonce:Field`. Compute nonzero `postId` using its own domain; do not derive the nonce or public ID from depositor, amount, deposit nonce, account, private chain ID/link or public order counter. The nonce stays private. Privacy relies on honest-wallet nonce generation; a circuit cannot prove that a user sampled uniformly. Public uniqueness is enforced by `postExists[postId]`, with explicit collision retry using a fresh nonce.

The private `post(depositChainId, postNonce, messageFields, messageLength, isDummy, hints)` validates/updates its private right and enqueues only `_publish_post(postId, messageFields, messageLength)` for a real post. That public function is `only_self`, rejects reused/zero IDs, validates canonical text packing and:

1. Reads live `postCount:u64`, assigns that value as `orderIndex`, and increments once with overflow checking.
2. Sets `publishedAt=context.timestamp()` and checked `flagDeadline=publishedAt+censorWindow` from **actual public inclusion**.
3. Captures the current onchain `policyVersion`.
4. Stores existence/content/timestamps/policy keyed by postId, and `postIdByOrder[orderIndex]=postId`.
5. Emits PostPublished V1.

The private proof neither reads nor supplies a reserved live postCount. Another author's post can change the count without invalidating this proof. Two spends of the same DepositNote still conflict legitimately. Ten distinct same-anchor authors must demonstrate progress in C03; this design is not a throughput measurement.

A dummy uses `postId=0`, requires empty/zero-padded content and does not enqueue public publication or consume a public order index. It remains an authentic private PostNote and obeys the same cooldown and screening transition. Dummy traffic can still have observable transaction/fee timing; no invisibility claim is made.

## 6. Policy, content and public feed contract

Message text is at most 992 UTF-8 bytes, packed as 32 Fields holding at most 31 bytes each; messageLength is u16. Policy is at most 1488 UTF-8 bytes / 48 Fields; policyLength is u16. Reasons are at most 200 UTF-8 bytes / 7 Fields; reasonLength is u16. Each chunk is interpreted big-endian, right-padded with zero bytes within its 31-byte chunk. All bytes past the declared length and all unused Fields must be zero. Reject noncanonical padding/ranges, invalid UTF-8 and embedded U+0000 at client/service boundaries; render text without HTML interpretation. Embedded zero text bytes are prohibited, while the required zero padding after the declared length remains canonical.

Policy identity is:

```text
policyVersion = SHA_FIELD(
  domain("AZTEC_BB_POLICY_V1") || word(1) || word(boardAddress) ||
  word(policyUtf8ByteLength) || exactPolicyUtf8Bytes
)
```

There is no normalization, terminal zero or padding after policy bytes in this hash. Empty policy is rejected for an enabled board. Publish policy content and the contract-computed version together in PolicyPublished V1; retain historical content by version through authenticated events/indexing. Re-publication of identical bytes has the same version. Existing posts retain their inclusion-time policyVersion. A later policy change applies to subsequently included posts; an eligible old post uses its historical matching policy, even if the authorized censor has since changed.

Public logical event payloads, enveloped by root's verified network/transaction/log scope, are:

| Event | Contract payload |
| --- | --- |
| `PolicyPublished` | schemaVersion, policyVersion, policyLength, policyFields |
| `PostPublished` | schemaVersion, postId, orderIndex, publishedAt, flagDeadline, policyVersion, messageLength, messageFields |
| `PostFlagged` | schemaVersion, postId, policyVersion, flaggedAt, censor, reasonLength, reasonFields |

The decoded service envelope carries `schemaVersion` at its top level, authenticates that it equals the raw event version, and projects packed content/length into the corresponding UTF-8 `text` or `reason`. Its `PostFlagged.censorAddress` is the raw `censor`. Its `PolicyPublished.censorWindow` comes from the authenticated immutable configuration for that exact board/scope; it is not an additional raw policy event field or a daemon-selected default. `PostPublished.publishedAt` and `flagDeadline` are the raw public inclusion values, not indexer receipt time. Preserve raw event position and verify event origin before accepting this projection; shape validation alone does not authenticate it.

A feed/job record must not contain depositor, depositNonce, private owner, depositChainId, private sequence/link or claim secret. Network `l1ChainId` is allowed and required in the public scope. A modelVersion is an offchain composite hash of reviewed runtime image, weights, prompt and inference settings, not a claimed onchain model attestation. Root owns that schema and the receipt/finality/journal rules.

`declare_immoral(postId, expectedPolicyVersion, reasonFields, reasonLength)` requires current nonzero authorized censor, an existing real post, no prior flag, and equality with the post's captured policyVersion. It permits flagging only while current public timestamp is **strictly less than** flagDeadline. It writes one immutable flag and emits the event. Policy/version/deadline mismatch reverts; no late transaction prepared earlier receives an exemption. Onchain flag reversal remains unsupported.

## 7. Authenticated screening and unbounded-lifetime hint access

Every submitted HintedNote is untrusted. Before using its content, require schema V1, contract address equal this board, owner equal the actual caller, and storage slot equal the slot derived by `self.storage.posts.at(owner)` using the matched state-variable implementation. Require `depositChainId` equality and valid sequence/types. Call actual `assert_note_existed_by(anchorHeader, hintedNote)` and perform the same explicit checks on the confirmed result. That helper proves inclusion under the supplied silo; it does not replace application ownership/slot/contract/ancestry authorization.

The immediate child must have `sequence=screenedSequence+1` and `previousLink=screenedLink`. Compute its authenticated link. Require child sequence <= headSequence, with link equal headLink exactly when its sequence is headSequence. Any second candidate must be the child's immediate successor under the same checks. A missing mandatory child, duplicate/foreign candidate, broken link, sequence gap or head inconsistency is an error, never permission to skip screening.

Process at most two consecutive candidates per transition. If no unscreened chain entries exist, hints must be empty. If a child is too young, do not advance it or a grandchild. If a mature child is not the head, require and authenticate the second candidate; advance it only if mature. This bounds per-call work while maintaining monotone history; it does not bound lifetime history.

For a real note, authenticated historical public reads at the anchor must establish `postExists[postId]`, publishedAt and flagDeadline. Require `anchorTime >= flagDeadline` before advancing; use the public inclusion timestamp, not the private note's earlier anchorTimestamp, to grant the censor a full window. At that boundary, late flags are already forbidden by public execution, so historical flag state cannot be changed by a subsequently included late censor transaction. Count each newly advanced flagged real post once. Dummies have no public flag and may advance after authenticated inclusion without an additional censor wait. Their anchorTimestamp cannot be in the future relative to the current anchor.

The local hint API is `get_screen_hints(owner, depositChainId, anchor)`, returning the exact next one/two HintedNotes plus explicit status. Query the owned PostNote slot by typed equality selectors for `(depositChainId, sequence)` **before** applying a bounded result limit. The 5.2 getter/viewer API supports typed selectors, owner scoping and offsets; raw note-oracle retrieval can retain HintedNote metadata for proof arguments. Implement the adapter against those verified APIs, not an invented RPC. Detect absent, ambiguous or stale candidates and re-sync/re-anchor as appropriate; never silently use the first unrelated deposit note.

Use the wallet's private local index for fast lookups and recovery; keys include board, owner, private chain ID and sequence and never go to the public feed. Recovery re-syncs supported note history and reconstructs this index. A bounded recovery page is a work unit, not an absolute lifetime cutoff; persist/retry the cursor until complete. C04 must demonstrate exact next-child lookup beyond 16, 32 and 1000 entries, two deposits under one account, prior deposit cycles and missing/duplicate/stale hints with actual PXE/TXE behavior. Oracle filtering remains an optimization: circuit checks provide authority.

## 8. Checked economics and finite exit

Let amount A, minimum m, base cooldown b, multiplier k and save cap M be the bounded integers above. Compute in u128:

```text
q = b*m / A
r = b*m % A
cooldown = max(1, q + (r != 0 ? 1 : 0))
saveFloor = saturating_sub(anchorTime, cooldown*(M-1))
effective = max(previousNextAllowed, saveFloor)
require(anchorTime >= effective)
nextAllowed = effective + cooldown*(1 + (k-1)*newlyScreenedFlagCount)
```

The quotient/remainder ceiling avoids an overflowing `numerator + A - 1`. A>=m implies cooldown<=b. With at most two newly screened flags, the declared bounds keep the increment below 2^49 and saved-time product below 2^48. All multiplication/addition/subtraction/casts remain checked; timestamps at the supported horizon are rejected before mutation. M=1 allows no saved burst; M permits at most M immediate posts, not M+1. Initial eligibility is claimAnchorTime+cooldown.

`lastRealSequence` changes only on a new real post. Each advanced candidate updates screenedSequence/link; no flag can be applied twice through a valid single-use DepositNote transition. New notes carry all remaining debt. A dummy charges the same base progression and any newly discovered penalties, allowing bounded history progress without a public message.

`withdraw(depositChainId)` consumes the exact owned live note, requires complete configuration, `screenedSequence >= lastRealSequence` and **anchorTime >= nextAllowedTime in every case**, including no-real-post and recently screened cases. It emits the exit message without creating any replacement DepositNote. The authenticated message and burned right are atomic application effects. Its recipient is the immutable stored portal; caller-provided destination overrides are absent.

The user can finish old real history through finite dummy transitions, wait out the resulting finite debt, then exit. Unscreened trailing dummies do not block exit once every real post is screened. Newly created deposits start a new nonce/claim/chain and cannot reuse former history. Lost secrets or a permanently unavailable protocol do not justify a refund that leaves an active right; recovery restores legitimate private state and resumes the same transition.

## 9. Required verification before this design is accepted as implementation

- C01/C06: known-answer cross-chain bytes/hashes; real authenticated ready/claim/exit; wrong actor, scope, config, secret, nonce, amount, replay and reentrancy; refund failure rollback and forced-ETH liability separation.
- C02: actual foreign-contract/wrong-owner/wrong-slot/same-owner-other-deposit/old-cycle note proofs fail; immediate successors and both dummy/real controls pass; one live right cannot fork; explicit packed selectors agree with note serialization.
- C03: no private live-counter reservation, ten same-anchor independent authors, post-ID collision refusal, actual inclusion time, and private/public revertibility behavior.
- C04: exact filtered retrieval past 16/32/1000 entries with meaningful absence/duplicate/reorg recovery controls; no first-page completeness assumption.
- C05: reference integer arithmetic/burst/rounding/overflow, age boundary, old-policy flags, late-flag rejection, exactly-once debt and delayed withdrawal/redeposit tests.
- P04/T05: root's executable service fixtures agree on all identifiers, bridge/policy commitments, public payloads and failure semantics. SDK initialization or mock bridge success is not real-proof assurance. X03 must independently establish target-network suitability before release.
