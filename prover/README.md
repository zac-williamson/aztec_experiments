# Board remote prover

One service serves one configured board/network. The browser retains signing,
private execution and witness generation. Only compressed witnesses and circuit
IDs cross the API. The board's public configuration supplies `remoteProver.url`;
visitors have a single Remote proving toggle, initially on when configured.
An unavailable remote service fails explicitly; there is no automatic local retry.

## Interfaces

- `remote-prover-wire.mjs`: versioned binary envelope, length checks, circuit IDs.
- `remote-prover-client.mjs`: `prove(steps, publicInputs)` HTTP transport.
- `routed-kernel-prover.mjs`: SDK witness generation and proof-result verification.
- `server.mjs`: HTTP admission; depends on the queue interface.
- `queue.mjs`: `submit/get/close`, FIFO and disk-backed payload lifecycle.
- `process-worker.mjs`: `prove(file)/close`, disposable subprocess and deadline.
- `worker.mjs`: trusted catalog, board witness validation, native BB backend.

POST `/v1/jobs` accepts the binary envelope and returns an opaque job ID.
GET `/v1/jobs/:id` returns queued/running/complete/failed. IDs are bearer secrets.
Clients poll the same job; no implicit submission retry. API version is 1 and
SDK/circuits are pinned to repository version 5.2.0. Circuit bytecode/VKs never
come from the requester. A circuit ID hashes length-prefixed bytecode plus VK.

## Local development

Use pinned Node 24.21.0. Copy `config.example.json`, set the devnet board address,
rollup version and page origin, then run:

```
node prover/start.mjs /absolute/path/to/config.json
```

Add to the existing board configuration:

```
"remoteProver": { "url": "http://127.0.0.1:8081" }
```

The development server uses `proofs: "disabled"` and requires loopback binding
and chain 31337. The app detects the devnet's `realProofs: false`; it generates
complete witnesses, exercises the queue/API and substitutes a development proof.
Local proving also follows devnet mode. No SDK dependency patches are needed.

The isolated application integration test starts/stops its own HTTP service:

```
BOARD_TEST_PROOFS=disabled BOARD_TEST_REMOTE=1 node scripts/test-c01-application.mjs private-fee-post
```

This is functional testing, not cryptographic proof qualification.

## Hosted / real proving

Set `proofs: "real"` and an appropriate thread count. Startup locates the pinned
native binary and verifies/copies the bundled CRS into `.build/prover-crs`.
Optional `bbPath` and `crsPath` override those locations. Point the board config
at the hosted HTTPS endpoint. The remote and local adapters use the same API
and SDK witness path. Real results are decompressed and cryptographically
verified in the browser, then the SDK checks expected public inputs.
The real proving implementation must be qualified with genuine proofs before
production use; development tests do not establish this.

Use a TLS reverse proxy, preferably `/prover` on the board's own origin (strip
that prefix upstream). Allow its endpoint in CSP connect-src. For client rate
limits behind a proxy, set `trustedProxy` to its exact socket IP and have that
proxy overwrite `X-Real-IP` with the verified client IP. Never expose that
trusted upstream interface to untrusted peers. Forwarded headers are ignored
otherwise. Do not log request bodies, job URLs or proof contents.

Default limits: 1 active proof, 1,000 retained jobs, 2 GiB pending payloads,
8 MiB/request, 32 circuits, 64 MiB total expanded witnesses, 4 outstanding jobs
per client IP, 6 submissions/minute/IP, 8 concurrent uploads, 120-second worker
deadline. Pending jobs expire after 30 minutes; results after 60 seconds.
Payloads are deleted immediately after processing. Normal shutdown removes all
owned jobs/processes. Abrupt shutdown does not resume jobs; use ephemeral,
encrypted storage and clean orphan directories at deployment startup.

Public visitors are rate limited, not authenticated. Distributed abuse remains
possible; IP limits are an initial cost bound, not Sybil resistance. Board
witness context is checked against the configured address before native proving;
valid proofs for other boards cannot use this endpoint. Invalid witnesses can
still consume the bounded worker time. Chain-state freshness may expire while
waiting in a long queue; failures are explicit and require a fresh transaction.

Witnesses contain private information, including protocol privacy-key material.
The service operator must be trusted with that data. Transaction signing keys
and the wallet seed are never included by this adapter.
