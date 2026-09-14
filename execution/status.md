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

The previous journey stalled before Ethereum refund settlement. Its local prover
kept only one prior epoch of jobs and discarded the oldest pending work. This was
reproduced with the actual broker. Retention now matches the local64-epoch proof
window, with explicit runtime checks; both old/fixed scheduling controls passed.
The stalled run was stopped and all owned processes and temporary data cleaned.

The fresh run accepted all four exit epoch proofs, including checkpoint11. Its
30-minute exit deadline fired during the finalized-tag wait, before refund.
All owned processes and temporary setup were cleaned. No refund pass is claimed.
The next fresh run allows45minutes exit and75minutes overall, with unchanged
20-minute Ready,8GiB memory and single-thread limits. Application bytes and all
proof/finality constraints remain unchanged.

## Remaining release work

Screening, concurrent posting, long-history handling, penalty/exit semantics,
wallet recovery, fee privacy, frontend/feed, moderation and operator tooling
still have open graph work. Independent review, fourteen days of representative
soak testing and current Aztec V5 deployment clearance remain release gates.
Local Anvil finality and proof timings are not mainnet finality/performance claims.
