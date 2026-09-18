# Full application bridge qualification

The scoped local application package passes. This is not production release,
public-testnet compatibility or independent cryptographic review.

Current unflagged run015 passed in384341ms, sampled peak1325568KiB, under the
unchanged540s/2GiB bounds. The real node verifies actual application proofs;
official accelerated local settlement handles actual emitted messages. No network
epoch prover or disabled application verification. All owned process trees and
temporary directories were removed.

Five adversarial claim inputs were checked before the valid claim. Wrong nonce,
amount, supplied index and secret fail at the pinned missing-message lookup;
a corrupted genuine sibling path fails the Noir root constraint. The test then
clears its deliberately poisoned PXE cache and requires one canonical source
refetch with exact path/index equality. The legitimate claim proves and includes,
followed by real post, screening, eligible exit and exact L1 refund. Negative
probes do not constitute completed hostile proofs. The pinned oracle-returned
index is not constrained; no claim of testing that nonexistent constraint is made.

Failed013 remains retained. Diagnosis014 and three actual-installed-SDK cache
regressions establish test contamination and restoration; no application circuit
or production cache behavior was changed. Independent internal review016 examined
source correspondence and positive control.

Acceptance mapping:

- A01: flagged004, redeposit006 and current unflagged015 genuine full journeys.
- A02: actual state, delivered/replacement notes, nullifiers, receipts, public
  posts/flags, private fee debits, protocol fees and L1 liability/refund accounting.
- A03: exact origin/input/membership, consumed claim/exit and absent-chain rejection,
  unscreened/time-locked exits and valid-state controls. Old consumed Outbox leaf
  rejects before membership; corrupt unconsumed membership is a separate probe.
- A04: expressly permitted documented-blocker branch, public-testnet-review005.
  Public compatibility is unqualified; fresh live identity/suitability checks remain.

source-reconciliation016 records actual file differences for historical004/006.
Those reports retain their original source and qualified scenarios. Later harness
changes add optional negative probes and resource supervision; current015 exercises
the changed claim path. Contracts/artifacts remain unchanged. All recorded current015
inputs match; no wholesale same-source claim is made for historical tests. Final T05
reconciles/reruns required scenarios on a frozen candidate. Distinct moderator in
flagged004 uses test public fees; author private fees are independently reconciled.

The former implicit audit-before-packet cycle was explicitly corrected in review011.
diagnostic-coverage.json retains all26original/57fresh occurrences and zero closed
warnings. Observable delivery/privacy work belongs to T03, recovery to T04, exact
inventory to R01 and qualified independent disposition to X01/X02. No failed internal
probe is deferred to an auditor or counted as passed. The overall repository snapshot
includes other concurrent work; this qualification applies only to the named T02
inputs and scenarios, not unfinished operations code.
