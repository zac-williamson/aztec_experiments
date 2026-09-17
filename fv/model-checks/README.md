# Finite transition checks

Run `python3 fv/model-checks/check.py` from any directory. Python 3 standard
library only; no dependencies, services, compilation or network access. The
checker emits source SHA-256 identities, explored state/edge counts and concrete
mutation counterexamples. A correct-model violation, undetected mutation, more
than 150,000 states or 30 seconds total raises an error. Root acceptance must
record the Python version and emitted output against the candidate source.

This is an executable, finite **specification check**, not a Lean theorem,
implementation equivalence proof, Noir constraint test or cryptographic proof.
The transition relation is handwritten. Source hashes establish which files were
reviewed; they do not establish that the model implements every source behavior.
Actual Solidity, Noir/TXE and application-proof suites remain separate gates.

## Reviewed source mapping

* `billboard/portal/src/BillboardPortal.sol`, `deposit`: requires an enabled
  portal and no active receipt; increments owner nonce, stores amount and adds
  liability before sending the Inbox message. `withdraw`: removes the exact
  current receipt, subtracts its stored amount, consumes the scoped Outbox
  message and pays that amount; failure rolls the whole transaction back.
* `billboard/billboard_contract/src/main.nr`, `claim_deposit`: consumes the
  authenticated L1 message before creating a private deposit note. `withdraw`
  consumes that note and emits a receipt-bound exit only after screening/time
  checks. The bridge model abstracts these two operations as `claim` and `exit`.
* The same file, `post`: consumes/recreates one deposit note, screens at most
  child and grandchild in exact sequence, stops at immature real predecessors,
  charges each newly screened flag, and appends a real or dummy note. Its
  `withdraw` requires screened sequence >= last real sequence and now >= debt.
* `billboard/billboard_contract/src/lib.nr`, `compute_next_allowed`: with
  cooldown=1, k=3 and max_save_up=2 the equation is
  `max(previous, max(0, now-1)) + 1 + 2*newly_screened_flags`, and posting requires
  now >= the effective prior debt. These are the checker constants, not new
  application settings.

## Exact finite domains and assumptions

**Bridge:** breadth-first reachable exploration through nine transitions; two
owners, deposit amounts 1/2, two nonce generations per owner, one unit of optional
forced surplus. Explicit total/balance/paid-in/paid-out state must satisfy
`total == sum(active amounts) == paid-in - paid-out` and
`balance == total + forced surplus`. Claims must consume each receipt once;
refunds require its exit and cannot exceed deposits. A failed refund is a
transactional identity transition. The mutation removes only the consumed-claim
guard and yields `deposit; claim; claim`, violating note uniqueness. Real
activation, Inbox/Outbox membership, hashes/scoping, checked-width arithmetic,
reentrancy and rollback implementation are assumed, not proved. The bridge exit
step assumes the screening model's withdrawal precondition; the two models are
not a mechanically composed whole-system proof.

**Screening:** breadth-first reachable exploration through eleven transitions;
now=0..7, at most three post notes, fixed two-tick publication window, cooldown=1,
k=3, save-up cap=2. Starts immediately after a valid claim with initial due=1.
Real post inclusion is modeled at its anchor time; delayed inclusion and snapshot
races are excluded. Flags can occur only before the immutable deadline. Dummy
notes mature immediately. Withdrawal is terminal; redeposit is modeled only in
the bridge check, not as a combined screening lifecycle. No unscreened real
predecessor may be skipped, at most two existing notes advance per posting,
newly screened flags are charged once, and withdrawal cannot erase debt.

The skipped-screening mutant advances past an immature real child and is
rejected on a reachable same-time saved-up post sequence. The debt-reset mutant
allows exit with unpaid debt **only after a flagged post has been screened**;
the counterexample includes claim-state, a real post, a timely flag, mature
screening by a dummy post, and premature withdrawal. This prevents a trivial
initial-lock-only example from standing in for penalty coverage.

No public-observer, private-fee metadata, entropy, kernel/reset, oracle-honesty,
cryptographic soundness, liveness beyond these bounds, or unlinkability result
is claimed. In particular, this does not rehabilitate the historical `True`
propositions elsewhere in `fv/`.
