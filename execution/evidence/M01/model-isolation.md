# M01 model runtime isolation evidence

This is an implementation-lane record for M01-A04, not an independent external audit or a completed production model evaluation. Parent integration owns overall M01 acceptance. No existing user wallet, network transaction, model weight download or paid service was used.

## Environment and command

Executed with Node.js 24.15.0 on macOS (`process.platform=darwin`), Docker Desktop 4.41.2 (191736), Docker Engine 28.1.1 API 1.49, Linux arm64 / kernel 6.10.14-linuxkit. The probe and transport use:

`docker.io/library/node@sha256:f22d6a1f082c02f292e86929b5b0442ac2e5eaf438a5dea9b1566601c3e05940`

The image was made locally available using a bounded pull of that exact digest. No implicit pull occurs in the runtime. An earlier abbreviated image reference did not resolve in local inspect; the fully qualified reference resolved and is used throughout the implementation. An initial internal-network-only published endpoint remained unreachable on this Docker installation, motivating the current fixed transport architecture; that unsuccessful prototype is not counted as passing evidence.

Final affected-source test command:

```bash
/Users/zac/.nvm/versions/node/v24.15.0/bin/node --test censor-daemon/model-runtime.test.mjs > execution/evidence/M01/model-isolation.log 2>&1
```

Observed exit 0, 2 tests passed, 0 failed/skipped/cancelled. Raw output: [model-isolation.log](model-isolation.log). `git diff --check` also exited 0. Afterward, queries for the test role labels and `billboard-model-` networks returned no resources.

## What was exercised

- Actual Docker containers execute the harmless Node probe with the production isolation profile. The real LLM entrypoint is not exercised.
- Model image must be digest-pinned and local model file hash must match before Docker startup; missing/mismatched pins fail.
- Inspect verifies model and transport UID/GID 65532, read-only root, nonprivileged mode, all capabilities dropped, no-new-privileges, CPU/memory/PID bounds, private process namespaces, no extra devices or volumes, exact read-only single-file bind, bounded noexec/nosuid tmpfs, expected image and exact image-default-plus-HOME environment.
- Model network is internal, IPv4 gateway mode `isolated`, IPv6 disabled. Actual inspect reported model gateway empty and IPAM only a subnet, with no gateway. The model had no default route. Both model and proxy were running, and the loopback health endpoint remained healthy after adverse inputs.
- A newly created host-only dummy signer file and dummy host environment variable were absent inside the model. No Docker socket was present. Root and model file writes failed; `/tmp` writes succeeded. `/proc/self/status` reported no-new-privileges and zero effective capabilities.
- A TCP listener on the macOS host was positively reachable from the transport using `host.docker.internal`. Its resolved IP and port were then passed as harmless probe data; the model could not connect. This negative result establishes denial to the tested reachable endpoint/platform, not a universal network theorem.
- Inspector rejection tests mutate real inspect results to add a secret environment variable, weaken tmpfs options, allow a writable bind, use host PID namespace, add SYS_ADMIN, or revert the network gateway mode. All rejected.
- Actual proxy requests reject unknown routes, absolute-form URLs and CONNECT. An over-64-KiB request is rejected/closed; an over-1-MiB model reply returns 502. Upstream Location and Set-Cookie headers are removed and content type is fixed. A deliberately disconnected partial request body leaves the transport running and its health endpoint responsive; error/aborted handlers cancel the associated deadline/upstream. The proxy has a 120-second total deadline and bounded connection count; waiting 120 seconds for the deadline was not part of this test.
- Normal test cleanup removed both owned containers and networks. Source review verifies cleanup attempts all owned resources independently and aggregates failures; Docker failure during cleanup was not injected in this suite.

Sanitized observed probe result (also in raw log):

```json
{"outcome":"pass","platform":"darwin","gatewayMode":"isolated","modelGateway":"","networkIpam":[{"Subnet":"172.18.0.0/16"}],"positiveControlHostReachable":true,"uid":65532,"gid":65532,"hostSecretReadable":false,"hostSecretEnvironmentPresent":false,"dockerSocketPresent":false,"rootWritable":false,"modelWritable":false,"tmpWritable":true,"noNewPrivileges":true,"noEffectiveCapabilities":true,"noDefaultRoute":true,"hostEgressAvailable":false}
```

## Architecture and source basis

The model joins only the isolated internal network; a small separate transport joins that network and an ordinary bridge and publishes only `127.0.0.1:<port>`. The transport forwards two fixed routes to `model:8080`, accepts no configurable upstream, and has no wallet/SDK/workspace access. It sees public moderation inputs and model results only. Its outside route makes the transport part of the trusted boundary; a model cannot use its HTTP API as a general egress proxy.

Official Docker documentation, checked 2026-09-12 UTC, states ordinary internal bridges retain a host bridge address and may reach services listening there; `isolated` gateway mode removes the address. Source: [Docker port publishing, gateway modes](https://docs.docker.com/engine/network/port-publishing/#gateway-modes). The current profile explicitly requires that mode and fails closed if inspect lacks it. Docker's [network create documentation](https://docs.docker.com/reference/cli/docker/network/create/#network-internal-mode---internal) supplies the ordinary-internal-mode host-access caveat.

## Limits and downstream work

- The actual production LLM image, executable compatibility, model provenance, weights, resource capacity, prompt behavior and moderation accuracy remain M03 work. `/app/llama-server` is an explicit required image interface, not a claim that a particular published image has already been verified.
- The actual Docker test ran on Desktop/macOS. Repeat on the selected production Linux host with its firewall/network configuration and a positively controlled reachable host fixture before release. Isolated gateway mode removes the directly connected host bridge gateway, but this run is not a separate native-Linux-host test.
- Keep model bytes immutable after verification. The host operator, Docker daemon and kernel are trusted; no claim is made against host-admin compromise, container/kernel escapes, or modification of trusted transport/signer code.
- The host signer is still responsible for fixed authority and bounded data validation (other M01 lane). M02 durable recovery/policy freshness and M03 prompt-injection/quality evidence are separate gates. No production readiness or independent cryptographic assurance is inferred from the probe.

## Source fingerprints at this run

```text
5da0629c1f5be38be0316d89310e4e4b2b9a1a2227cc3806c32e2521a6ae4fe7  censor-daemon/model-runtime.mjs
82419a64b28b7115f10ee24fc81167dd093b724d10b9497b6ace14d70535201e  censor-daemon/model-runtime-proxy.cjs
42e177b2cde047e574a3a27f60b9113ab8f0bd8d6ba21d668fa14bca93beea2b  censor-daemon/model-runtime-probe.cjs
85db06328a94f82a78707ce5c6bf322acaa78124388f6fe94b96c3152b8e4997  censor-daemon/model-runtime.test.mjs
80a348ee46eae4516da928522b7ea84e4de1f37b4bbc67a52f75157c6cdd4fc0  censor-daemon/README.md
```
