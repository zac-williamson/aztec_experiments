# Actual browser application proof — bounded integration plan

Source inspection only. No server, browser or proof was started for this plan.
Use fresh disposable local chain 31337, never a mainnet/testnet endpoint or user
wallet. Keep the existing parent supervisor's 540-second deadline and sampled
2 GiB aggregate owned-descendant RSS; cleanup includes browser, HTTP servers,
PXEs, sequencer, Anvil and temporary data. Do not extend bounds to force a pass.

## Existing fixture boundary to reuse

`scripts/test-c01-application.mjs` starts loopback Anvil with a fresh in-memory
mnemonic, builds genesis and calls `qualifyC01RealNode`.
`scripts/c01-real-node.mjs` creates the genuine-verifier node and explicitly
asserts realProofs=true, no prover node and no epoch proving. It deploys/includes
the board, creates the portal, and uses the existing explicit local Ready
settlement helper. That is a sufficient parent-owned setup boundary for a
browser callback **before** its finally block stops the node. Do not start an
independent node or network prover.

Reuse `withC01ClientMining` around the callback: it mines ordinary Anvil blocks
and keeps TestDateProvider synchronized. Existing sequencer startup and validator
handler registration in c01-board-inclusion must remain in place. Official local
settlement helpers may later qualify refund availability, but are not public
network finality evidence.

## Exact pinned JSON-RPC server interface

The installed package's `dest/bin/index.js` demonstrates:
`registerAztecNodeRpcHandlers(node, services, undefined, options)` followed by
`createNamespacedSafeJsonRpcServer(services, rpcOptions)` and
`startHttpRpcServer(rpcServer, serverOptions)`.

`register_node_rpc_handlers.js` installs `aztec` and legacy `node` aliases using
AztecNodeApiSchema. It also installs `p2p`; remove that service for this browser
fixture, or construct only `{aztec:[node,AztecNodeApiSchema],
node:[node,AztecNodeApiSchema]}` using the same exported schema. Do **not** supply
an adminServices object or debug:true. No admin, debug, P2P or private-PXE API
needs to be reachable from the browser. Ordinary node APIs include transaction
submission and public protocol data, not wallet secret storage.

`startHttpRpcServer` accepts `{host:'127.0.0.1',port:0}` and returns the native
HTTP server augmented with `.port`; omitting host could bind beyond loopback.
Use explicit body/batch bounds and origin allowlisting matching the one fresh
browser origin. Close connections and await server.close in finally. Keep the
node in process; expose standard schema serialization rather than inventing a
handwritten JSON transform for Fr, Tx, block headers or proofs.

For HTTPS browser execution, reuse the disposable HTTPS static-host fixture and
put only `/rpc/aztec` and `/rpc/ethereum` behind a **test-only** same-origin reverse
proxy to the loopback servers. This avoids mixed-content/Private Network Access
and preserves CSP connect-src. Production hosting currently serves static assets;
do not silently turn its general configuration into an unrestricted RPC proxy.
Restrict Ethereum forwarding to methods needed for the test wallet/client. Anvil
admin controls such as state mutation and mining stay parent-only, not exposed to
page code. Server binding/CORS/origin checks remain necessary even for fresh funds.

## Smallest real proof experiment

First qualify **one actual browser-paid application transaction**, rather than
attempting six proofs before measuring browser cost. Native setup may prepare
an active board and fund the disposable author's private fee balance with existing
W01 helpers, stopping its native PXE before browser initialization. Preserve the
exact author seed/salt only in test memory. Export its actual encrypted portable
backup through the existing wallet backup helper, then restore through the built
page's visible file input. Browser PXE must discover genuine note data; do not
insert fake private balance notes.

Import the real local public configuration through its visible GUI; values come
from the running node/portal and reviewed explicit test gas cap. Connect a minimal
test EIP-1193 provider backed by the disposable signer in memory, with an exact
method allowlist. It must return chain31337 and refuse other chain/account requests.
Never override runBillboardUser, createPXE, prover, sendTx or receipt functions.

A minimally useful first case is native setup/claim followed by one **browser
post**: enter message, click Post, let the actual bundled WASM prover run, capture
the resulting Tx at the real node's normal sendTx boundary, require nonempty proof,
normal validator acceptance, canonical successful receipt, exact public post,
private note transition and private fee debit. Record proving duration separately
from preparation, load, CRS and inclusion. Native setup is not browser journey
coverage and must be labelled as such.

If this fits, add a separate bounded browser claim/no-post withdrawal profile and
then flagged screening/refund/restart profiles. Do not count partial profiles as
a complete GUI journey; each missing step remains explicit. Reuse snapshots only
with preserved state/artifact provenance and genuinely fresh browser storage.

## Risks and required observations

Native node plus Chromium WASM proof may exceed 2 GiB even though each alone fits.
Keep them serial where possible (stop setup PXE/prover, retain node verifier),
retain one browser context and control worker concurrency through supported SDK
options. A resource abort is evidence to optimize the browser path, not permission
to switch the browser prover off or move its proof back into Node.

The SDK JSON-RPC server may expose methods beyond those invoked; inspect the
schema and keep binding/origin/body limits. Log only method names, timings, public
hashes and sanitized classifications; request/response bodies can contain private
execution information. The test provider must not put secrets in page console,
traces, screenshots, logs or repository files. Browser transport should not need
any external URL. Assert all attempted external requests are blocked.

A cold CRS success is only initialization. This experiment must retain the actual
browser application proof and node verification evidence before calling browser
proving qualified. The current successful hosting report explicitly says
provingQualified:false and cannot substitute for it.
