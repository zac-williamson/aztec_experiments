# Read-only packaged monitor drill preparation

Prepared from source; no drill executed and no fixture hook added.

## Reuse and budget

Reuse the deployed portal from `completeC01Bridge` after its activation assertion, before private-fee/browser work. Available identity inputs are `ready.portalAddress`, `instance.address`, `node.getNodeInfo()` and `config.l1RpcUrls[0]`. Prepare a real operator package outside the proof run; `packageOperator` builds the runtime closure, and `operator-launch.sh monitor <public-config>` selects the actual packaged monitor. No retained package was found under `.build` during this inspection. Do not package inside the bounded browser run.

A future disjoint `scripts/o01-monitor-failover-drill.mjs` can run three sequential commands with one 15-second total deadline: working local forwarding endpoint, local HTTP 503 endpoint, alternate local forwarding endpoint to the same chain. Permit only `eth_chainId`, `eth_getBlockByNumber`, `eth_call`, `eth_getCode`, and `eth_getBalance`; reject mutations, cap request/response/output sizes, track abort controllers and sockets, terminate owned child processes on deadline, and remove only owned temporary configs. Persist fixed parsed classifications, not arbitrary subprocess stderr or RPC errors. This is operator-directed alternate-endpoint recovery, not automatic failover or independent-provider consensus.

## Clock limitation must remain visible

`deploy/operations-monitor.mjs` checks chain/portal/rollup identity and performs reads at one canonical EIP-1898 block. Its production freshness check rejects timestamps more than 30 seconds ahead of wall time or more than 180 seconds behind. `c01-settle-application-message.mjs` advances the disposable chain epoch; `c01-client-mining.mjs` synchronizes its test clock to mined time. Consequently a working endpoint can correctly produce `OBSERVATION_STALE` in this fixture.

Keep that real packaged classification. Do not spoof block timestamps, preload a fake wall clock, or loosen production freshness limits. The unavailable endpoint must yield `OBSERVATION_UNAVAILABLE`; a recovered alternate may honestly yield `OBSERVATION_STALE`, demonstrating transport recovery but not a healthy operational observation.

Separately invoke the actual read-only `readEscrowSnapshot` against the same portal to verify canonical accounting, identity, active state and balance-versus-liability. Report this as direct accounting verification, distinct from packaged CLI freshness/health. It does not establish `ESCROW_BALANCED` from the production command.

## Remaining acceptance requirement

A genuine healthy packaged command (`ESCROW_BALANCED`, exit 0), followed by unavailable and alternate healthy commands, still needs a deployed active portal on a chain whose timestamps fit the unchanged production wall-clock limits. The accelerated fixture cannot be assumed to meet this. This preparation performed no deployment, proof run or transaction. Local disposable deployment remains within the engineering authorization; no network prover is needed.
