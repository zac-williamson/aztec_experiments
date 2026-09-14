# Project status

The message board is **not production-ready**. Engineering is continuing; no
user decision is needed for the current local work.

## Working and verified

- The pinned Aztec5.2 toolchain, reproducible artifacts and dependency checks pass.
- Authenticated deposit messages, portal wiring and the compact eight-field note
  are implemented. The recorded contract checks pass101/101 and portal checks29/29.
- Fresh local deployment of the actual board passes a genuine client proof,
  ordinary node verification and successful checkpoint inclusion.
- Portal binding also passes a genuine client proof and inclusion, emitting the
  exact expected activation message. This does not yet enable deposits.
- The deployment app now uses the supported finality API and rejects unsuccessful
  or stale receipts. Current client/artifact checks pass53/53; its page is rebuilt.
- Local commit0d82197 saves these changes and their evidence. Earlier application
  checks remain historical evidence for their recorded source snapshots.

## Current work: complete the real bridge journey

The full epoch proof failed because the installed lightweight prover lacks public
VM proving support. No epoch proof, finalized bridge activation, real deposit
claim or real no-post exit is claimed. The failed run stopped after507seconds,
peaked below5GiB sampled process RSS, and cleaned its processes and temporary data.

The full native AVM prover now builds successfully from the authenticated release
source. A preserved incremental build completed in9.6minutes with about2.3GiB
peak compiler memory. Original failed attempts remain recorded. The full prover
then passed real-verifier local node startup in22seconds with AVM support enabled.
All owned build/node processes and temporary directories were cleaned.

The actual deposit/claim and no-post withdrawal helpers are prepared and reviewed
against the pinned SDK, but have not executed. The next run will retry genuine
epoch settlement with the full prover and temporary authenticated setup.

Next: qualify the resulting full prover, then resume genuine epoch settlement,
finalized portal activation, deposit/claim and withdrawal checks. Internal task
C01 tracks this authenticated deposit and bridge work; its acceptance remains open.

## Release work still required

The remaining contract, wallet, moderation, frontend, operations and integration
packages stay in the execution graph. Independent audit,14-day soak, operator
acceptance and fresh target-network clearance are mandatory release gates.
Production publishing, paid services and real-fund transactions are not authorized.

Execution remains one active package, one bounded delegated lane, and serial
heavy runs. The graph validates35 packages and141 criteria; six packages are done.
