# M01 runtime review

Disposition: **pass for the bounded M01 runtime separation change; no unresolved blocking finding from this review.** This is a separate AI code review, not the mandatory external application audit or production-host qualification. The reviewer implemented the signer/daemon lane, did not implement or edit the runtime/proxy/probe, and reviewed the current runtime code, tests, documentation and recorded Docker results read-only.

## Findings and dispositions

1. **Cleanup stopped after its first failure — resolved.** The final `stop()` attempts removal of each owned proxy/model container and both networks independently, then aggregates failures. Startup errors invoke cleanup and propagate failure; neither startup nor cleanup silently falls back to a native model. Failed Docker administration can still leave resources requiring operator cleanup, and the code reports that failure rather than promising unconditional removal.
2. **An ordinary internal bridge did not establish host-gateway isolation — resolved for the configured/tested profile.** Creation now requires IPv4 `isolated` gateway mode with IPv6 disabled. Inspection rejects a different mode, a container gateway, any IPAM gateway, additional model networks or published model ports. The recorded Docker run reports an empty model gateway, no IPAM gateway/default route, and denial of a controlled host listener that was reachable from the transport. The README correctly requires rerunning on the intended production host; this macOS Docker Desktop result is not a blanket claim about every Linux deployment.
3. **README incorrectly attributed the post index to model output — resolved.** It now assigns the index to the validated post list and limits model output to the verdict and reason.
4. **Runtime evidence initially lagged a final disconnect-handling change — resolved.** The runtime owner reran the affected Docker tests after the partial-request error/abort handlers and recovery check were added. Final recorded fingerprints now match the reviewed proxy, test, runtime, probe and README. The refreshed log records 2 passing tests and no failures or skips.

## Boundary and failure behavior

The model receives only its hash-checked, read-only model file. Inspection checks non-root identity, read-only root, dropped capabilities, no privilege escalation, private process namespaces, bounded CPU/memory/process/tmpfs resources, the digest-pinned image, and the intended environment/mounts. The model receives no signer wallet, workspace, Docker socket, or inherited host secret environment. Unsupported settings or absent image/model pins reject startup visibly.

The transport is explicitly trusted: it has an external network route but no wallet material or signing interface. Request data cannot choose its destination. Only the fixed model health/completion routes are forwarded; CONNECT, absolute request URLs and other routes are rejected. Request/reply buffers and a total deadline are bounded, disconnects destroy upstream work, and upstream redirect/cookie headers are discarded. Malformed or oversized replies fail through HTTP errors and cannot authorize signing.

## Evidence and limits

Reviewed `model-isolation.log`: **2 tests passed, 0 failed, 0 skipped**. The actual harmless container probe checks dummy host-file/environment exclusion, absence of the Docker socket, denied root/model writes, allowed temporary writes, capabilities/privilege restrictions and controlled egress denial. Tests also reject weakened profiles and unsupported proxy routes, verify size limits, and check healthy recovery after oversized replies and a partial-request disconnect. This reviewer inspected that recorded run; it is not a separately rerun container experiment.

The README accurately leaves host/Docker administrators, kernel compromise and malicious changes to trusted signer/transport code outside the claim. Trusted model files must remain immutable while mounted. Model/image provenance evaluation, actual LLM compatibility and quality, durable retries/policy freshness, production Linux host qualification and external review remain later acceptance work. A process with Docker administration rights can intentionally undo this profile; startup inspection does not protect against a malicious administrator after startup.

## Reviewed bytes

Recorded at 2026-09-12T06:28:49.399072+00:00. Source fingerprints were checked against the refreshed implementation-lane evidence.

| File | SHA-256 |
| --- | --- |
| `censor-daemon/model-runtime.mjs` | `5da0629c1f5be38be0316d89310e4e4b2b9a1a2227cc3806c32e2521a6ae4fe7` |
| `censor-daemon/model-runtime-proxy.cjs` | `82419a64b28b7115f10ee24fc81167dd093b724d10b9497b6ace14d70535201e` |
| `censor-daemon/model-runtime-probe.cjs` | `42e177b2cde047e574a3a27f60b9113ab8f0bd8d6ba21d668fa14bca93beea2b` |
| `censor-daemon/model-runtime.test.mjs` | `85db06328a94f82a78707ce5c6bf322acaa78124388f6fe94b96c3152b8e4997` |
| `censor-daemon/README.md` | `80a348ee46eae4516da928522b7ea84e4de1f37b4bbc67a52f75157c6cdd4fc0` |
| `execution/evidence/M01/model-isolation.log` | `3e83595493a3e87adb479572554d941e23c43c4459d429d38da05229e34edb60` |
| `execution/evidence/M01/model-isolation.md` | `d93c99ec3665f02e07c9a7971e2aedc346f8fda9cdfa8b77eaccb7eae1e13000` |
