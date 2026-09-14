# Project status

The message board is not production-ready. Engineering continues; no user
decision is needed for the current local work.

## Verified

- Pinned toolchain, reproducible artifacts and dependency qualification are done.
- Authenticated deposits, one-time portal binding and compact eight-field notes
  are implemented; the logical wallet view retains all eleven values.
- The full103-case Noir suite passed, followed by four additional binding-authority
  negatives. All29 portal and53 client/artifact checks pass.
- Genuine local Ready proofs, Ethereum settlement, finalized membership and portal
  activation have passed repeatedly.
- The latest full journey passed claim inclusion, exact note checks, rejection of
  a consumed-deposit replay, and no-post exit inclusion/note consumption.

## Current work

The latest journey stalled before Ethereum refund settlement. Its local prover
kept only one prior epoch of jobs and discarded the oldest pending work. This was
reproduced with the actual broker. Retention now matches the local64-epoch proof
window, with explicit runtime checks; both old/fixed scheduling controls passed.
The stalled run was stopped and all owned processes and temporary data cleaned.

The next fresh full journey must pass genuine exit settlement and actual L1
refund/accounting, including rejection of a repeated refund. It remains bounded
to60minutes and8GiB with one native proof agent. Continuous ordinary L1 mining
through client proving has already resolved the earlier claim-inclusion failure.
No final refund or whole-journey pass is claimed yet.

## Remaining release work

Screening, concurrent posting, long-history handling, penalty/exit semantics,
wallet recovery, fee privacy, frontend/feed, moderation and operator tooling
still have open graph work. Independent review, fourteen days of representative
soak testing and current Aztec V5 deployment clearance remain release gates.
Local Anvil finality and proof timings are not mainnet finality/performance claims.
