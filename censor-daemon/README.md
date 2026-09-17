# Moderation daemon

The daemon reads Billboard posts, asks a local model for a bounded moderation verdict, and passes accepted violations to a host-side signer. The signer fixes its CLI, wallet, portal and node configuration at startup. Model output supplies only a validated violation decision and reason. The post identity and captured policy come from the validated public feed; the model cannot select an executable, wallet or transaction destination.

## Runtime prerequisites

- Use the repository's pinned Node.js 24.21.0 and built CLI dependencies (see `../BUILDING.md`).
- Use Docker Engine 28 or newer with Linux containers and support for bridge gateway mode `isolated`. The runtime checks the resulting profile and fails closed if it differs.
- Supply a reviewed, locally available image pinned by `@sha256:…`, containing a CPU-compatible `/app/llama-server`. It must support the flags below and serve `/health` and OpenAI-compatible `/v1/chat/completions` on port 8080. Image provenance and actual model compatibility/quality remain the M03 acceptance work; no production LLM image is endorsed here yet.
- Supply one local GGUF file and its trusted SHA-256. Keep that file immutable while the daemon runs and readable by container UID 65532. The daemon hashes it before startup and mounts only that file read-only. Calculating a hash of an untrusted download alone does not establish model provenance.
- The transport uses the pinned Node image below, also available locally. Images and weights are not downloaded or compiled automatically.

```bash
docker pull docker.io/library/node@sha256:6dac556d980b7f0e5498d08f08cee0ca67798b4ad6c23964a9214920e67758d0
```

## Local evaluation

After setting the variables to your reviewed model inputs and disposable local deployment, run from the repository root:

```bash
node censor-daemon/daemon.mjs \
  --portal-address "$LOCAL_PORTAL_ADDRESS" \
  --private-fee-config /absolute/path/private-fees.json \
  --node-url "$LOCAL_AZTEC_NODE_URL" \
  --eth-rpc "$LOCAL_ETH_RPC_URL" \
  --censor-wallet "$DISPOSABLE_CENSOR_WALLET" \
  --model-image "$REVIEWED_MODEL_IMAGE_WITH_DIGEST" \
  --model-manifest "$RESOLVED_PLATFORM_MANIFEST" \
  --model "$LOCAL_GGUF_FILE" \
  --model-sha256 "$TRUSTED_MODEL_SHA256" \
  --dry-run --once
```

Dry-run evaluates posts without submitting flags. The wallet file must still exist because signer configuration is validated at startup. This example is for an existing disposable local deployment; it neither provisions a wallet nor deploys contracts. Live flagging requires a configured deployment and funded censor account and is a separate operator action.

## Isolation boundary

`model-runtime.mjs` supervises two uniquely named containers and two networks:

1. The model attaches only to an internal IPv4 bridge in `isolated` gateway mode, without a bridge gateway, default route, external DNS or published ports. IPv6 is disabled. Its only host bind mount is the specified GGUF file.
2. A small Node transport joins the internal model network and a separate bridge. Only its port 8080 is published at `127.0.0.1:<llama-port>`. Its sole host bind mount is `model-runtime-proxy.cjs`.

Both containers run as UID/GID 65532, with a read-only root, all capabilities dropped, no privilege escalation, private process namespaces, a 128-process limit, CPU/memory limits, and a 256 MiB `noexec,nosuid` temporary filesystem. Image defaults plus `HOME=/tmp` are their complete environment. No signer wallet, workspace directory, host Docker socket, host process namespace or inherited host secret environment is provided. The runtime inspects and verifies these properties before and after startup.

The transport sees public post/policy data and model verdicts, never wallet material. It forwards only `GET /health` and `POST /v1/chat/completions` to the fixed internal `model:8080` service. It rejects CONNECT, absolute URLs and other routes, caps requests at 64 KiB and replies at 1 MiB, and enforces a 120-second total deadline. It forwards no upstream redirect or cookie headers. A request cannot choose a remote destination. The transport has a network route outside the model network, so its small fixed-route implementation is part of the trusted boundary.

Docker documents why an ordinary internal bridge still permits access to host bridge services, and why `isolated` gateway mode removes that bridge address: [Docker gateway modes](https://docs.docker.com/engine/network/port-publishing/#gateway-modes). Tests here demonstrated the profile and a blocked controlled host endpoint on Docker Desktop for macOS; repeat the isolation suite on the intended production host. This is not assurance against a compromised host administrator, Docker daemon, container kernel or malicious changes to trusted transport/signing code.

Normal exit, startup errors, SIGINT and SIGTERM trigger removal of both owned containers and networks. Cleanup attempts every owned resource and reports aggregate failures. `--skip-bootstrap` and `--keep-server` are unsupported; there is no production option to substitute an arbitrary external model endpoint or start a native model process with signer access. Test-only programmatic runtime injection is not reachable through production CLI flags or environment variables.

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `--portal-address` | Required | L1 portal fixed for this process |
| `--private-fee-config` | Required | Public private-fee contract/gas configuration file, fixed in the restricted signer |
| `--censor-wallet` | `wallets/censor_aztec_wallet.json` | Existing host-side censor wallet |
| `--node-url` | `http://127.0.0.1:5080` | Aztec node fixed for this process |
| `--state-dir` | `.moderation-state` | Private durable queue and model identity directory |
| `--model-image` | Required | Reviewed local image with immutable digest |
| `--model-manifest` | Required | Exact offline OCI platform manifest matching the image digest |
| `--model-memory-mib` | `4096` | Explicit container memory limit in MiB |
| `--model` | Required | Local GGUF file |
| `--model-sha256` | Required | Trusted 64-character lowercase SHA-256 |
| `--llama-port` | `5090` | Loopback transport port, 1024–65535 |
| `--threads` | `4` | Model threads and CPU limit, 1–16 |
| `--ctx-size` | `4096` | Context size, 512–32768 |
| `--policy` | Unsupported | Local policy overrides are rejected; use the onchain policy |
| `--poll-interval` | `30` | Poll interval in seconds, 1–3600 |
| `--from` | `0` | Only zero accepted; durable jobs cannot be skipped |
| `--cli` | `apps/src/billboard/user/cli.mjs` | Trusted CLI path fixed at startup |
| `--dry-run` | Off | Evaluate without submitting flags |
| `--once` | Off | Exit after one polling iteration |

Model memory defaults to 4096 MiB; the transport gets 512 MiB and one CPU. M03 must benchmark an actual pinned model within those bounds before release. The daemon refreshes an atomic onchain policy snapshot each poll and binds every flag to the reviewed policy version. It rejects local/default policy substitutes. Each post uses its captured historical policy from the validated feed. Missing policy content fails closed. Durable SQLite jobs retain decisions, leases, deadlines and receipt progress across restarts; completion requires a finalized successful receipt and its matching canonical flag event. See [the queue runbook](../execution/moderation-queue-runbook.md) for retry, backup, dry-run and attention-state procedures.

## Tests

Run with the pinned Node on `PATH`:

```bash
bash censor-daemon/run_tests.sh
# Include the actual Docker boundary tests:
bash censor-daemon/run_tests.sh --with-docker
# Or run only the Docker suite:
node --test censor-daemon/model-runtime.test.mjs
```

The default runner covers moderation, signer, daemon, wallet-command validation, durable jobs, crash recovery, model identity and canonical flag reconciliation with mock infrastructure. The Docker suite requires Docker and the pinned Node image and executes a harmless probe under the actual model isolation profile. It uses newly created dummy secret fixtures, verifies a host listener is reachable from the transport but denied to the model, checks filesystem/environment/socket restrictions, tests weakened profile rejection and transport input bounds, and removes its own resources. Neither suite uses an existing wallet, downloads an LLM, proves moderation quality, or submits network transactions.

The runtime API is `startModelRuntime({image, modelPath, modelSha256, port, threads, ctxSize})`, returning `{port, containerId, proxyId, inspect, stop, modelIdentity, configurationBytes, promptBytes}`. Callers must await `stop()` on exit. The probe helper is solely for isolation testing.

## Censor fee funding

Before starting the daemon, fund and claim the censor wallet's private fee balance using the existing private FeeJuice funding page. Use the same censor wallet and canonical private fee contract as the daemon configuration. The daemon spends an already claimed private balance; it does not repeat a bridge claim each time it starts a CLI process. Do not supply a claim-secret file to the daemon.

The required `--private-fee-config` points to the public JSON configuration accepted by the user CLI (contract address and gas settings). Its absolute real-file path is validated and fixed when the restricted signer starts, then forwarded to the CLI. Model output cannot override that path, gas route, wallet or operation. Keep the host configuration file under operator control; changing its contents is an operator action, not a model capability. Fee exhaustion remains a visible signing failure until the wallet is funded again.

The daemon also requires `--eth-rpc` explicitly. The restricted signer fixes and forwards this Ethereum endpoint alongside the Aztec node URL; it never selects an ambient shared RPC configuration. HTTP(S) endpoints with embedded credentials or fragments are rejected.

## Reproducible model evaluation

Use `evaluate-model.mjs --corpus censor-daemon/evaluation-corpus.json --output <results.json> --runtime-config <runtime-options.json> --model-manifest <platform-manifest.json>`. The runtime options contain the same pinned image, local weights path/hash, context, threads, port and memory limit used by the daemon. The manifest must be a single platform OCI image, not a multi-platform index; its exact bytes must hash to the image reference. The runtime binds local and running image IDs to the exact config digest or verified platform descriptor, and evaluation rechecks mounted weights after the run. Keep host model files immutable; these checks do not defend against a malicious host operator changing and restoring files between checks.

Each invocation performs at most480seconds of work and records results atomically, then verifies identity and cleans up owned Docker resources. Resume with the same inputs/output to evaluate remaining cases. Exit2 means incomplete or unmet quality/capacity criteria; it is not a successful qualification. Errors remain in the retained sample set. An orphaned output lock after a forced process kill requires checking its recorded PID and owned runtime resources before removing that exact lock; never run concurrent writers. The evaluator never receives a wallet or invokes the signer.

See `docs/moderation-review.md` for corpus provenance and irreversible-flag/review limitations. Model-only analytical capacity does not replace measured flag submission latency or the required elapsed workload trial.
