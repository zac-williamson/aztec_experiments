# Packaged monitor drill review

Read-only source review, 2026-09-18. Reviewed `test-o01-monitor-failover-anvil.mjs`, `o01-monitor-drill-transport.mjs`, `MonitorRootPublisher.sol`, and actual monitor/launcher interfaces. No live tests or source edits. Root already assigned outer-timeout/child-ownership correction and drill-source hash recording; those remain separate prerequisites, not duplicate findings here.

## Assessment

No additional blocking interface or accounting defect identified. The drill executes the real packaged shell launcher and pinned packaged Node monitor command in a fresh process with isolated environment. It does not replace the monitor implementation. The live portal uses verified production bytecode/immutables, and activation/deposit receipts plus direct liability/balance/activation reads establish a real nonzero escrow observation.

The monitor reads Ethereum state using one canonical block-hash tag. Successful command output is compared to the independently recorded block height/time, exact1000wei liability and balance, zero difference and active status. Post-command checks require unchanged canonical latest block hash and operator nonce. The proxy permits only fixed read methods. Together these provide meaningful read-only and accounting checks; the direct second `readEscrowSnapshot` is corroboration using the same implementation, not an independent accounting oracle.

The fixture's inherited RootPublisher deliberately publishes controlled roots, while real Inbox/Outbox and portal code consume them. Its added `getVersion` supplies the actual monitor interface. This is appropriate for an L1 monitor drill and must not qualify rollup proving, Aztec transaction execution, production finality or genuine application settlement. Existing report flags correctly state controlled roots, no Aztec execution and no network proofs.

## Evidence boundaries to preserve

- Three separate commands point success→unavailable→success at controlled transports backed by the same Anvil. This demonstrates manual endpoint replacement and fail-closed unavailable status, not automatic failover, independent provider agreement, or recovery from a reorg. The report's `independentProviders:false` is correct.
- Package verification currently compares selected launcher/monitor/identity files to current source and their manifest hashes, plus the packaged Node hash. It does not iterate every manifest entry or validate every transitive dependency. Describe this as checked command-path files within an existing package; retain/link the package's full preparation verification before making a whole-package integrity claim. A manifest digest alone is not external provenance.
- Genuine assertions cover balanced active escrow and transport unavailability. Insolvency, surplus, inactive portal, stale chain and identity mismatch are not exercised by these three commands; retain existing tests or separate evidence for those outcomes.
- Preserve the instructed lifecycle correction and final hash inventory before a live run. A successful command alone cannot excuse leaked children/transports or late work after the deadline.

Transport input/output bounds and fixed error responses avoid retaining arbitrary RPC diagnostics in the final report. Temporary credentials are not added to reported fields. Actual execution and cleanup remain unqualified until the bounded drill passes.
