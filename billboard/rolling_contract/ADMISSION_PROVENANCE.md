# Admission port provenance

Approved G06 same-contract port; baseline integration f9911f0, worker merge e3303f7.

- Original `billboard_contract/src/main.nr` SHA256 `7bcfdd2770c181dd02736903884ab166d5d5603a68e16462ffe830cb1ac788ab`.
- Original `billboard_contract/src/lib.nr` SHA256 `b4e084588485dd6473bbe22832f8c1461c51693200b5b1c0fde08e4c5cdaecf7`.

Retained: V1 bridge/config/deposit/exit encoding; amount/chain/version/portal bounds; one-use bridge consumption; exact owned deposit selection; app-NHK private history links; owner/contract/storage/deposit/sequence authentication; historical public inclusion/deadline checks; 0–2 mature screenings; cooldown/save-up/penalty mathematics; recovery horizon; exact eligible exit to original L1 depositor.

Changes: new undeployed RollingBoard storage owns these notes; no migration or old-state access. Publication separates canonical social metadata from admission and uses authenticated content logs plus digest instead of 32 content storage writes. Private public-post ID is still fresh nonce-derived. No owner/deposit/history link enters publication. G05 initializer now also validates actual admission configuration; prior G05 assertions remain. Public plugin callback uses request ID and board-derived frozen invocation hash, never human account.

Economic route: fresh existing ETH portal bound to this board/config; PrivateFPC is an account-batched sibling. Aggregate ETH/USDC onboarding and real proof/accounting remain G08/G13. No public fee fallback, fabricated deposits, relaxed deadlines or counterfeit eligibility endpoint.

Reversible defaults approved by lead: likes need fees but no collateral; new references to removed posts fail, existing references remain tombstones; root posts carry zero root reference in invocation preimage but store their actual post ID as canonical root. Plugin ID cannot change adapter; disabling prevents new invocations and does not touch request refunds.

Static comparison of the full original Admission private state transition (deposit
pop through refreshed note delivery), normalizing whitespace and the module name,
matches exactly after removing the legacy publication dispatch. Evidence:
`evidence/g06/admission-static-comparison.json`. New canonical publication is
enqueued after that same transition; no original eligibility/screening/exit guard
was removed. Grouped subboard storage leaves the newly ported historical maps and
username storage positions unchanged relative to the initial G06 candidate.

Raw compile 3 exits 0 with 79 diagnostics: 71 retained manual-constraint diagnostics in 14 pinned
external dependency locations and 8 disconnected-subgraph warnings. This is compilation evidence only. Those diagnostics
are not waived or characterized as harmless, and the specialist constraint/privacy
review gate remains open. G05 validation.json is historical evidence for its named
revision; G06_CHECKPOINT.json identifies this unprocessed, untested extension.

The retained G05 artifact stores the username Owned set at slot 6; G06 compile 3 stores it at slot 31. G06 inserts admission storage before
that set, so this fresh contract schema changes its slot. It must never be deployed
as an in-place update over G05 state. The constrained ownership helper and utility
viewer both obtain the same generated `storage.names` slot; no hard-coded G05 slot
is reused. The earlier statement about unchanged username placement referred only
to the subsequent subboard consolidation relative to the initial G06 candidate,
not compatibility with the G05 deployment schema. No G05 deployment exists.

Independent diagnosis approved the existing Billboard `PluginStorageRoot` pattern
for likes: `LikeStorageRoot` reserves one normal macro-allocated slot without
embedding a PrivateContext. Public-only accessors construct normal typed
Map/PublicMutable containers; no raw storage oracle or SDK changes are introduced.
Keys are Poseidon2([1,post,0],0x52434c53) for u64 counts and
Poseidon2([2,post,tag],0x52434c53) for bool active state. The standard Map then
derives slots under the unique allocated root. Distinct type fields prevent
structural count/active aliasing; post framing prevents cross-post aliasing;
remaining hash-collision risk is the standard Map/Poseidon assumption. The tag
itself remains separately domain-separated under 0x52434c31.

Raw compile 7 passes with 83 retained diagnostics (75 manual-constraint, 8
subgraph), 98.73 s and 1,831,518,208-byte max RSS. Frozen source/output and the
compiled layout comparison are in evidence/g06. Every compile 3 storage root is
preserved; the new like root is 33. The only subsequent Noir change before review
is the TXE deployment string for the real PrivateBok artifact: the installed
resolver requires `../experiments/private-bok@private_bok/PrivateBok` across
workspaces. Current and compiled hashes are distinct in G06_CHECKPOINT.json.
No 89-test execution, processed-artifact or mined-rollback claim is made here.
