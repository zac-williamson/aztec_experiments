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
  exact expected activation message. A subsequent genuine settlement test enabled deposits.
- The deployment app now uses the supported finality API and rejects unsuccessful
  or stale receipts. Current client/artifact checks pass53/53; its page is rebuilt.
- Local commit0d82197 saves these changes and their evidence. Earlier application
  checks remain historical evidence for their recorded source snapshots.

## Current work: complete the real bridge journey

Genuine epoch settlement and portal activation passed in the disposable local
network. Both proof receipts were accepted by the real Ethereum verifier; the
actual local finalized tag and Outbox membership were checked before enabling
deposits. The run took18.5minutes and peaked at7.8GiB sampled process memory.
Owned processes and temporary data were cleaned. This does not qualify Ethereum
mainnet economic finality or production timing.

The full native AVM prover is built and qualified. Earlier lightweight-prover and
time-budget failures remain recorded; they are superseded by the successful run,
not relabelled as successes. Local commit37ff4e3 preserves native qualification.

The first full journey repeated genuine Ready activation and accepted a real L1
deposit. Its private claim proof passed normal node validation, but checkpoint
inclusion timed out after a local publisher failure. No refund pass is claimed.
The run took21.4minutes, peaked at6.5GiB, and cleaned all owned processes/data.
Root and the reused review agent are investigating publisher/mining timing;
reviewed replay and content-mismatch controls are being added before retry.
Authenticated bridge acceptance remains open; no user decision is needed.

## Release work still required

The remaining contract, wallet, moderation, frontend, operations and integration
packages stay in the execution graph. Independent audit,14-day soak, operator
acceptance and fresh target-network clearance are mandatory release gates.
Production publishing, paid services and real-fund transactions are not authorized.

Execution remains one active package, one bounded delegated lane, and serial
heavy runs. The graph validates35 packages and141 criteria; six packages are done.

Latest retry preparation:103/103 Noir checks and53/53 client/artifact checks pass.
Continuous-mining lifecycle checks pass on actual disposable Anvil. The next
full journey includes actual consumed-claim replay rejection.
