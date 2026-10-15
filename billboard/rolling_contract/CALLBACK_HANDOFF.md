# G06 callback rollback integration handoff

The package-local `callback-rollback.mjs` exports `assertMinedCallbackRollback`.
It creates no services, accounts, deployments, funding receipts or clock controller.
The existing lead-owned disposable-chain fixture supplies those dependencies. No
consumer execution is claimed by the source addition.

## Preconditions and invocation

Pass actual pinned-SDK `node`, `wallet`, `owner`, deployed `board` (RollingBoard),
`bok` (PrivateBok), `depositId`, fresh nonzero `nonce`, canonical `draft`, funded
waiting `requestId`, immutable registered `pluginId`, `reason`, `outputDirectory`,
existing `mineL1`, `payerMode`, and the existing `privateFeeAction` only for private
fees. The fixture is restricted to actual L1 chain ID 31337. Name ownership must
exist and its ID appear in the first wallet-local ownership page; use a fixture
account with at most eight names. This is a test setup bound, not an application
pagination restriction. The selected deposit must already be eligible for a post.

Use three separately authorized requests, fresh post nonces and fresh exclusive
intent filenames:

- `mismatch`: request target commits a different canonical nonce/body than the
  candidate draft. Keep the plugin enabled and request before its deadline.
- `disabled`: authorize the exact target, then disable that same immutable plugin
  binding through the moderator. Keep the request before its deadline.
- `expired`: authorize the exact target, keep the plugin enabled and advance
  canonical L2 time to or beyond its actual deadline with the existing supervisor.

The fixture must also execute the matching successful callback path through
RollingBoard and compare request ACTIVE state, post record/count, changed private
deposit sequence and retained name ownership; the new TXE success case defines
these expectations but is not actual-chain evidence.

## Evidence and failure semantics

The consumer checks processed artifacts/private VKs, locked embedded sources,
local source equality and both deployed class IDs. It obtains exact private
screening hints, prepares the actual named `post_with_bok` transaction with the
existing `proveApplicationAction` helper and requires the expected public rejection
from that exact transaction. It then requires a valid private transaction and
writes an exclusive intent before one `sendTx` call. It deliberately sends this
local negative case; no failure is retried or re-proved automatically.

Acceptance requires a CHECKPOINTED/PROVEN/FINALIZED **REVERTED** receipt whose
block and effect hashes agree with the node. Dropped, pending, thrown simulation,
timeout and unknown outcome do not count. PXE is synchronized before and after;
post count/record, selected deposit's complete logical fields, the fixture's owned
names, request accounting and private available credits must be unchanged. No
L2-to-L1 message may survive. Private values remain in memory and are compared
without putting them into assertion details or the saved report.

The report binds source and artifact hashes, deployed class IDs, exact transaction
hash, block/effect hashes, proof policy and payer mode. It never claims real proofs
when `applicationProofsEnabled()` is false; a public genesis payer leaves privacy
acceptance open. Real deposits, private fees, privacy traces and release gates
remain separate requirements. Parent fixture evidence must bind its own source,
actual funding operations, environment and cleanup.

On any unknown submission outcome, stop and reconcile the saved transaction hash
before any new attempt. An existing intent deliberately fails closed. Do not erase
it to replay the case. A new fixture is allowed only after previous owned services
and mutable data have been reconciled and cleaned up.
