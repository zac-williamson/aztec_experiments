# Operational application qualification

Scope: local production-engineering candidate, pinned Aztec 5.2.0 and Node 24.21.0.
Commands ran from the repository root with its pinned Node and Foundry binaries.
This closes internal operational implementation, not operator deployment acceptance.

## Measured results

- Current escrow, moderation-health and feed-health checks: 21 passed in 755 ms.
  Injected failures distinguish deficit, surplus, inactive/stale/unknown observations,
  identity failure, stalled requests and moderation work requiring attention. Outputs
  use fixed classifications and aggregate public accounting, excluding private data.
- Public RPC cancellation: 25 focused checks passed in 459 ms. Two actual HTTP
  regressions failed before repair and pass after aborting rejected unread bodies.
- Packaged local monitor failover: passed in 2,270 ms against genuine portal state
  with controlled bridge roots and canonical bridge contracts. The sequence is healthy → unavailable → alternate healthy. The separately
  configured transport returns balanced nonzero
  liabilities/escrow. Independent reads agree and no monitor transaction is sent.
  These are local transports to one fixture, not independent production providers.
- Packaged handover, policy update and saved-journal restart: passed in 236,765 ms;
  sampled owned peak 1,289,472 KiB. Both new transactions have real proofs, successful
  canonical receipts and the shared private fee payer. The successor has zero public
  FeeJuice, and both authors' public balances remain unchanged. Private credit debits
  and public fee-pool accounting are checked independently.
- A fresh successor process reconciles the identical policy operation using preserved
  wallet/PXE/journal files in 4,671 ms. It returns the original receipt, attempts zero
  sends (including rejected attempts), and changes neither fee credit nor policy.
  This qualifies confirmed-operation restart, not injected lost-response recovery.
- Updated operator package smoke passed in 5,840 ms, including dependency/resource
  closure, command entry points and encrypted wallet/claim-secret recovery. It does
  not substitute for genuine transaction qualification above.
- Owned application process tree and temporary directories were removed. Local monitor
  processes, connections and temporary directories were also cleaned up.

## Evidence and changes

Actual command report: application-9a786967-5f22-4ddd-a30e-a2060bbea042.json.
Monitor report: monitor-failover-046.json. Package report: package-smoke-046.json.
Current focused outputs: operations-checks-046.log, public-rpc-after-046.log,
recovery-io-045.log, harness-validation-045.log. Earlier failed results are retained.

The synchronization failure was a test RPC batch limit of one, conflicting with
SDK batching. The default bounded official limit fixes it. Actual bundled PXE/HTTP
regression advances its anchor and fails with the old limit. Temporary query tracing
was removed. CLI simulator initialization is explicitly local and manifest-verified.
Independent reviews also required cleanup completion before success reporting and
counting every attempted send during recovery; both changes were integrated.

The command report precedes the isolated read-only public-RPC cancellation fix.
Its transaction implementation is unchanged; the affected transport has direct
before/after regression coverage and the operator package was rebuilt. This record
preserves those verification boundaries. T05 must verify one final release candidate.

## Runbooks and external limits

The deployment/private-fee lifecycle prerequisites retain their own acceptance
records. The fresh private-fee application journey035 additionally passed actual
funding, collateral claim, exit and Ethereum refund. Operational documentation states
activation, authority rollback, unknown-outcome and withdrawal limitations. A lost
current moderator key has no contract administrator override. Unknown outcomes must
remain fenced; the confirmed-restart result is not claimed as every outage rehearsal.

credential-provenance-007.md identifies the historical exposed provider credential
and source removal without reproducing its value. External revocation, replacement
and restriction remain operator duties in O02. Named responders, delivered alerts,
missing-run detection, approved public endpoints and production monitoring ownership
also remain O02. No paid service, real funds or live deployment was used.
