# RollingBoard protocol foundation

G05 integrated foundation with a G06 candidate extension for collateral-backed posts.
This package is a **new, undeployed contract**, pinned to Aztec 6.0.0-rc.1. It does
not replace the existing funded board, and it does not yet meet all G05, G08 or
G13 acceptance criteria. The assigned changes outside this package are its entry in the parent Nargo
workspace and the corresponding local-manifest/embedded-source dependency inventory.

## Names and private ownership

`register_name(first[32], first_length, last[32], last_length)` is private. Inputs
are the normalized display arguments produced by `shared/rolling/name-policy.mjs`:
ASCII letters, spaces, apostrophes and hyphens, each component 1–32 bytes, with
letter boundaries, no repeated spaces, zero padding. The wallet trims/collapses
spaces; the circuit rejects noncanonical input and derives lowercase canonical
bytes itself. Reserved first name `bok` is rejected in every display case.

The six-field canonical hash preimage exactly matches the JavaScript policy:
`[first_length, first_packed_31, first_tail_padded_31, last_length,
last_packed_31, last_tail_padded_31]`, Poseidon2 domain `0x52434e31`. Length framing
separates component boundaries. The public `_register_name` gate is `only_self`
and atomically rejects duplicate IDs. Private mint and public registration share
one transaction; a rejected registration cannot leave a usable ownership note.

A two-field `UsernameNote {name_id, schema}` is inserted into a fixed-slot
`Owned<PrivateSet<UsernameNote>>` belonging to the authenticated private caller.
Constrained encrypted onchain delivery is required. `_assert_name_owner(id)`
selects the exact note, pops it with authenticated ownership/nullification and
recreates it for the same caller. Future posts and profile updates must invoke
this in-contract helper. `authenticate_name(id)` currently exercises only this
ownership path; it is neither a post nor a bypass of posting admission.

`owned_names(owner, page_offset)` is a wallet-local, eight-item utility page. Zero
entries mark unused results. Its owner argument and results must never go to the
public index/cache API. Names cannot be retired or transferred. Public state
contains registration flags and display logs, never an owner address or a list
of other names belonging to an account. Global uniqueness is within one curated
RollingBoard deployment, not across independent operators' deployments.

**Limits:** callers must use the existing private fee path; this package alone
does not enforce fee-payer privacy. Separate registrations must not be batched in
one public transaction. Encrypted note delivery does not prove node-query privacy.
Real competing transactions, reverted-mint behavior, key-assisted account restore,
public-effect inspection and RPC trace analysis still require G08/G13 execution.

## Subboards and effective policy

`init(main_rules[32], length, l1_chain_id, rollup_address, rollup_version, min_deposit, max_deposit, base_cooldown, k, censor_window, max_save_up)` records the moderator, main policy v1 and immutable V1 bridge/admission configuration.
The moderator can publish a new main policy through `set_main_policy`; each update
increments its version and emits the complete policy bytes and digest.

`create_subboard(slug[40], slug_length, name[3], name_length, description[16],
description_length, rules[32], rules_length)` is private and checks an authenticated
nonzero caller. It has no posting-collateral condition. Normal transaction fees
still apply. Only metadata crosses the `only_self` public creation gate; creator
identity is not stored or emitted. Slugs use 3–40 lowercase ASCII letters, digits
and hyphens, with alphanumeric boundaries and no repeated hyphens. This is a
reversible first-release encoding choice, to be reflected in the index/client.
The slug hash uses `[length, packed_31, padded_tail]`, domain `0x52435331`.

Creation records a unique immutable slug, complete display name/description/local
rules in authenticated logs, metadata and local-rule digests, and the main-policy
version at creation. No nested-board, rename, archive, transfer, local-policy-edit
or homepage-promotion operation is exposed. Local rules remain v1 in this slice.

`effective_policy(id)` returns `(current_main_version, current_main_digest,
local_version=1, local_digest, rejected)`. The parent reference is read dynamically,
so parent updates propagate to every subboard. Both rule sets remain separate and
must be applied as a union; local text is data and cannot replace the parent.
The contract does not claim to semantically interpret contradictory natural-language
rules. The parent moderator can reject them after publication.

`reject_subboard(id, reason[7], length)` requires the moderator, an existing active
subboard and a nonempty reason. It retains identity, metadata and the policy
versions used for rejection; the complete reason is logged and its digest stored.
Repeated rejection cannot silently replace a reason. `subboard_state(id)` returns
`(exists, metadata_digest, main_version_at_creation, rejected, reason_digest)`.
Rejected state is terminal in this foundation; reversal/appeals need an explicit
later decision. The frontend must show the directory tombstone and reason.

**Limits:** G06 publication checks active subboards and live parent/local versions atomically. Private withdrawal depends on deposit screening and its timelock, never a subboard status. Real bridge and rejected-board exit acceptance still require the later integrated journey. No existing deployed state is reused.

## Bounded storage and archive format

All text fields contain right-padded 31-byte big-endian fields. The circuit checks
field range, exact byte length, zero padding and well-formed UTF-8 (rejecting NUL,
overlong encodings, surrogates and code points above U+10FFFF).

| Data | Maximum bytes | Packed fields |
|---|---:|---:|
| Main/local rules | 992 | 32 |
| Subboard display name | 93 | 3 |
| Description | 496 | 16 |
| Rejection reason | 217 | 7 |
| Each global-name component | 32 | 2 |
| Subboard slug | 40 | 2 |

Public writes per operation, excluding protocol/deployment overhead: init 15 (including immutable value hashes),
registration 1, creation 6, main-policy update 2, rejection 6. Private ownership
refresh creates a note/nullifier and no public-storage writes. All are structurally
below V6's 63 public writes; this is not measured gas or inclusion acceptance.
Largest event (`SubboardCreated`) has fewer than 80 payload fields, well below the
4096-field aggregate log and 8475-field blob ceilings. Batch calls still share
transaction-wide protocol limits.

Event schemas are `NameRegistered`, `MainPolicyPublished`, `SubboardCreated`,
`SubboardRejected`, each schema 1. Only authenticated events from the configured
contract and canonical chain count. Index replay reconstructs full display/policy/
rejection content and verifies the stored digests. Names use `0x52434e31`, slugs
`0x52435331`, text `[length, fields...]` `0x52435431`, metadata
`[subboard_id, name_digest, description_digest]` `0x52434d31`. Chronological policy
events retain historical versions; recovery must retain the corresponding logs.
Reorg handling, retained archival data, encrypted-note discovery and client decode
implementation remain separate integration work.

## Checks and integration handoff

`src/tests.nr` contains pure encoding/adversarial tests and TestEnvironment tests
for two names, exact ownership, ordered duplicate conflicts, account-free-collateral
creation, current-parent-policy propagation and moderator rejection controls.
Three canonical preimage vectors were produced by the checked-in JavaScript
encoder, including a 32-byte boundary and punctuation. TXE tests are development
constraint tests, not real proofs, concurrency or account-restoration acceptance.

The package is included in the parent Nargo workspace. Its dependency inventory
adds only local manifest hashes and RollingBoard embedded sources, each checked
against the previously locked external package hashes. No dependency pin or source
is changed. The lead owns integration into the existing acceptance test harness. Do not bypass
those gates with an unrecorded generated artifact. Use the repository's pinned
Nargo (resolved by `scripts/toolchain.mjs`); no system-compiler substitution.
Compile and process the candidate with the pinned Node runtime using
`node billboard/rolling_contract/build.mjs`, then run the bounded local tests with
`node billboard/rolling_contract/test.mjs` from the repository root. Supply `NARGO`
only when this isolated worktree reuses the verified compiler from the main checkout.
The helpers enforce pinned runtime/packages/dependency hashes and normal private VK
processing; tests reject an unprocessed or stale local-source artifact. They use one
TXE worker and one test thread on a temporary loopback port, with a 540-second test
limit and supervised cleanup. `--filter tests::test_name` selects one exact test.
These candidate helpers do not replace canonical artifact provenance or real-proof
acceptance gates. There is no deployed address yet.

The pinned call-serialization macro uses a local variable named `offset` that can
shadow a same-named function parameter. The utility deliberately uses `page_offset`;
a regression checks the generated interface arguments for offsets 0, 1 and 2.
The correction changes no type or function selector. Earlier failing logs are
retained as diagnostic evidence; no SDK source was changed.

Follow-on APIs belong in this same contract for private ownership to remain local:
profile bio/current avatar; remaining social state; encrypted preferences.
Specialist privacy review, real wallets/proofs, chain rebuild/reorg, load testing,
elapsed soak and target-network clearance remain required.

### Candidate verification

On 11 October 2026 the normal processed-artifact run passed **40/40 tests** without
the diagnostic hook; the dependency checker passed **8 packages / 418 source files /
112 embedded dependency sources**. [validation.json](validation.json) freezes source,
compiler, artifact and raw-log hashes. The raw logs remain in the ignored package
`target/` for the lead to archive in the existing execution evidence layout.

The compiler emitted **19 constraint-coverage diagnostics** in pinned external
sources. Independent source mapping identified the upstream files; this does not
establish that the diagnostics are benign or replace specialist review. No compiler
safety flags, assertions, runtime guards, pins or dependency source were weakened.
Local TXE executes application constraints and public simulation, not real proofs.
Normal verification uses no diagnostic wrapper; `ROLLING_NOTE_DIAGNOSTIC=1` enables
the counts-only wrapper solely to reproduce the retained development diagnosis.

## G06 funded publication candidate

`admission.nr` ports the original V1 configuration, bridge framing, cooldown,
penalty and recovery-horizon arithmetic. `ADMISSION_PROVENANCE.md` identifies the
source revision. `main.nr` retains exact scoped historical-note authentication,
constrained encrypted delivery, private eligibility and guarded withdrawal. Claim
requires an authenticated L1-to-L2 receipt; a public deposit ID is never sufficient.
The new deployment needs a fresh configured portal and Ready activation. PrivateFPC
payment remains a sibling call in the account batch; there is no public payer fallback.

`post(deposit_chain_id, nonce, draft, child, grandchild)` accepts canonical UTF-8
up to 992 bytes. Draft fields are subboard (0 for main), parent, root_reference,
kind (1 ordinary, 2 quote, 3 repost), name_id (0 Anonymous), reference, message[32],
length and expected main/local policy versions. Named posts consume/recreate the
same private ownership note. No owner, deposit ID, note link or stable anonymous
identifier enters publication state, logs or callback. Fresh nonce generation is a
wallet obligation; replay of an existing post ID fails. This source slice does not
claim full transaction-graph, RPC or timing unlinkability.

The public gate derives the post ID and canonical root, rejects stale policies,
unknown/rejected boards, foreign-board replies, forged roots and missing/removed
references. Empty bodies are allowed only for reposts (reversible first-release
default). New replies/quotes/reposts cannot target a removed post. Existing records
and their relationships survive removal. Complete content is authenticated event
data; seven metadata fields plus order/existence/time/deadline/policy require 13
public writes per post (before external callback), not 32 additional body writes.

`screen` creates a private dummy history step with the original admission checks.
`remove_post` is moderator-only with complete reason events, live policy version
checks and original timely penalty semantics: flag 3 only before the deadline
under the same policy; changed-policy/late removal uses flag 1 without penalty.
`get_post` returns existence, metadata, flag, timestamp and reason digest. Indexers
must replay authenticated events to reconstruct bodies and reason text.

`configure_plugin` binds a stable nonzero plugin ID to one immutable nonzero
adapter; disabling never changes historical identity. `post_with_bok` publishes
through the same admission gate, derives the exact frozen 45-field invocation
preimage from validated content/scope and calls only
`on_invocation(Field request_id, Field derived_invocation_hash)`. Neither caller
hash nor human account is accepted. G14 must atomically authorize the funded
request; this candidate contains no fake successful adapter or free invocation.
The authenticated reply path is now implemented as described below; full G10 model/workspace execution remains separate.

G06 test evidence is pending. Added TXE cases use actual constrained receipt and
private note paths inside TestEnvironment; they are development constraint tests,
not network deposits or generated proofs. Like acceptance, browser wallet integration,
plugin execution/accounting, authenticated index reconstruction and the complete
G05/G06/G08/G13 acceptance journey remain outstanding.

The G06 predeployment storage schema consolidates six subboard maps into one typed
`SubboardRecord`. The pinned macro expands each storage context into its generated
private-self type; separate maps exceeded the fixed compiler complexity cap.
This changes neither external ABI nor semantics. Rejection reads the entire record,
changes only rejection flag/reason and writes it back, preserving immutable rules,
metadata and creation version. Username storage and admission historical slots
remain before this grouped record and are unchanged by this consolidation.

### Private likes (review repair candidate)

`set_like(post, active)` derives a Poseidon2 tag under domain `0x52434c31` from
`[1, chain, version, board, post, authenticated_app_NHK]`. The private caller cannot
supply the tag or another account's secret. Only the tag and post cross the public
boundary; no human account, name or reusable cross-post identifier is included.
A single account therefore has one active like per post across all of its names.
Repeated like/unlike calls are idempotent; a transition updates count and active
state atomically. New likes on removed posts fail; an existing like can be removed.
Likes require ordinary transaction fees but no posting collateral (approved,
reversible first-release default). PrivateFPC and RPC privacy remain integration
requirements. Pure tag-domain and constrained behavior tests are pending execution.

Review additions use the actual `private_bok` contract as a relative package
dependency, not a callback stub. TXE adds exact callback success and mismatch,
disabled and expired rejection cases. Noir's TestEnvironment cannot catch a
failed call and then inspect state; those rejection cases therefore do not prove
rollback. `callback-rollback.mjs` and `CALLBACK_HANDOFF.md` define the pending
mined-revert acceptance checks using the lead's existing chain fixture. All
original 74 test cases remain. Raw compile 7 passes with 83 retained diagnostics (75 manual-constraint and 8 subgraph); test execution and normal artifact processing remain pending. The later test-only deployment-path correction is recorded separately from that frozen compile. The test helper also requires the real processed PrivateBok artifact in its sibling workspace and verifies its embedded sources and private VKs before service startup.

## Current development verification and build order

On 11 October 2026, the reply candidate passed normal processed builds and all
106 RollingBoard / 69 PrivateBok TXE cases. The genuine local journey
`execution/evidence/G06/application-e58a6efc-ddbb-4327-9cc2-cb6d06fda1c2.json`
at source `5e68c221625afa494134bbea11ad28fe2243e25e` passed all original eight
rollback checks, an authenticated reply, exact replay/operator guard checks and
settlement/refund accounting in 524494 ms, with 1657408 KiB peak process-tree RSS.
Independent review is `execution/evidence/G06/reply-e58-runtime-review.json`.
This leaves little deadline headroom and is not reliability qualification.
The reply's billing receipt is explicitly synthetic; the distinct actual provider
accounting/recovery run is recorded under G14/application-28b68e72. Ordinary-node
query privacy, the connected interface and release gates remain open. Current
compiler manual-constraint diagnostics (75 Rolling / 44 Bok) still need specialist
disposition; older counts above describe historical candidates.

`PrivateBok.publish_reply` permits only its configured public bot operator, an
active unexpired request and no unsettled reservation. The board authenticates
the exact adapter, plugin, successful request activation and parent, then emits
complete `PostPublished` and `PluginReplyPublished` events. The reply has kind 4,
no human name and canonical parent/root/subboard linkage. One reply per request
is a reversible development default. Human `post` inputs cannot claim kind 4.

Run builds serially with the pinned Node executable from repository root:

```sh
node scripts/build-contracts.mjs
node billboard/rolling_contract/build.mjs
node experiments/private-bok/build.mjs
```

The canonical build fingerprints the entire Billboard workspace, including Rolling
Noir sources, and its compilation can replace the Rolling target with raw output.
Therefore run the Rolling processed build afterwards. Never edit the manifest to
bypass a stale-input failure. Verify `loadRollingArtifacts()` against the lead-owned
`prover/rolling-artifacts.json`; changed hashes require reviewed catalog regeneration.
Then build SDK/apps and run the selected acceptance scenario using TESTING.md.
Do not rerun a provider campaign to repair a build failure unless its retained
report establishes that no model call occurred; uncertain calls stay fenced.
