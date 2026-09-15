# Application tests

Use the pinned Node24 runtime and Foundry versions in BUILDING.md.

- `npm run test:application:unit`: contract execution in TXE, Solidity portal tests,
  and client/artifact tests. TXE supplies test messages and note-tree fixtures;
  these tests check application constraints, not network proving.
- `npm run test:application:bridge`: real application transaction proofs and node
  verification, actual local Inbox claims and Outbox consumption, portal activation,
  deposit-note delivery/burn, refund accounting and duplicate rejection. The parent
  enforces a nine-minute deadline and cleans its owned processes on failure.

- `node scripts/test-c01-application.mjs --screening`: real deposit claim and two
  real post proofs, checking authenticated screening and exact private-note state.
  Uses the same nine-minute bound; writes evidence under `execution/evidence/C02`.

The bridge test uses the installed Aztec SDK's `RollupCheatCodes` and
`settleEpochOutbox` to advance local epochs and settle actual emitted messages.
Network epoch proofs, protocol verifier qualification and Ethereum finality are
outside this application test. Settlement is explicitly labelled test-controlled;
application proofs and message membership/consumption are still checked.

No custom AVM build, server prover, epoch proving CRS or Docker is needed for these
checks. The installed native client prover and normal application proving assets
are used. The old `test-c01-real-network.mjs` entrypoint is retired and fails with
a pointer to the application test instead of launching network proving.

A passing application suite is not deployment clearance or an independent audit.
Supported-network smoke tests and the release checks remain in the execution graph.
Historical network-proving experiments remain recorded under execution/evidence;
they are not development prerequisites and must not be resumed by the graph.
