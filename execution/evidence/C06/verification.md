# C06 verification and disposition

The existing C01 escrow implementation already decrements aggregate liabilities,
uses checks-effects-interactions with a reentrancy guard, authenticates exact
receipt/Ready messages, preserves scoped nonces and rejects unsolicited ETH.
C06 adds verification and an accurate recovery runbook; no administrator,
postactivation pause, refund escape, migration or extra service was introduced.

From repository root, pinned Foundry with FOUNDRY_PROFILE=regression:
`forge test --root billboard/portal --offline --fuzz-runs 32 --fuzz-seed 0xc06`
passed37 tests,0 failures in65.53ms after compilation. The first unseeded run
also passed37 checks; final seed makes the generated sequences reproducible.
The32 generated cases execute24 operations across3 actors plus setup/drain,
checking independent receipt amounts/nonces, aggregate liabilities and forced
surplus after each operation. This is bounded fuzzing, not exhaustive assurance.

Six new adversarial dependency tests exercise exact reentrancy errors from all
three state-changing entrypoints during activation, deposit and withdrawal.
They check effects at callback boundaries, rollback, retry and duplicate exits.
Those dependency doubles do not authenticate proofs; separate tests use pinned
canonical Inbox/Outbox code with explicitly test-controlled root publication.
Existing tests also exercise recipient callbacks, invalid receipts/envelopes,
constructor bounds, failed transfers, forced ETH and the known-bad baseline's
stale aggregate accounting. Tests against actual generated deployment bytes pass.

A normal contract build passes (build-001.log). All deployed Noir artifacts,
private fee artifact and portal deployment bytes are byte-for-byte unchanged
from the verified C05 commit; runtime-artifact-comparison.json records hashes.
Thirty artifact integrity checks pass. New Solidity test sources update build
provenance but do not change application execution, so genuine proofs were not
repeated without a runtime change.

Prior genuine claim/exit/refund evidence is
`evidence/W01/application-0543b83b-7ca8-406c-890d-074c5ff17299.json` (4m50s,
actual application proofs/Inbox/Outbox/refund, official local settlement controls).
C05 requalified the new claim/post circuits and tested flagged debt/exit/redeposit
in TXE. These are separate scopes; do not call them a newly executed integrated
flagged L1 refund journey. Final candidate T05 must reconcile all evidence.

Root and the independent delegated test lane reviewed the new callback tests and
runbook without blocking findings. This is agent-assisted self-review, not the
external release audit. The existing recipient-reentry fixture accepts any revert;
new dependency callbacks require the exact guard selector.

The runbook is source-reviewed, not a completed production recovery drill. W02
still owns complete wallet/claim-secret backup UX and private-cache handling.
W03 must fix false unclaimed/paid status on failed discovery, the500-block scan
limit and arbitrary error-text 'already consumed' success handling. Those client
issues do not create an onchain administrator refund or bypass escrow liabilities,
but remain production blockers in their assigned packages.
