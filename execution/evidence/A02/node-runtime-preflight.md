# A02 Node runtime preflight — 2026-09-14

The workspace runtime and exact build pins are now Node **24.21.0**. Its executed
version metadata reports embedded Undici **7.29.1** and OpenSSL **3.5.8**. Aztec
5.2.0, Noir beta.25, Foundry 1.4.1 and Solidity 0.8.27 pins remain unchanged.
This is verified runtime provenance and pin integration; full compatibility and
dependency-advisory acceptance remain pending the integrated checks.

## Native download and verification

Official [release notes](https://nodejs.org/en/blog/release/v24.21.0) describe the
September 8 release. The official archive URL and checksum URL are retained in
`node-runtime-preflight.json`. Both were downloaded using HTTPS-only curl,
TLS 1.2 minimum, bounded connection and download deadlines. The archive was
downloaded into ignored `.build/A02-node`; no global Node or nvm installation
was modified.

The 52,909,993-byte darwin-arm64 archive's SHA-256 matched the exact filename in
the publisher's `SHASUMS256.txt` before extraction or execution:

`bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057`

Archive members were checked for absolute/traversing paths, non-file special
entries and links escaping the one intended extraction root. Extraction used
Python tarfile's data filter. The resulting executable is:

`.build/A02-node/node-v24.21.0-darwin-arm64/bin/node`

The executable's own SHA-256, complete observed `process.versions`, checksum
document hash and native platform are retained in `node-runtime-preflight.json`.
`assertNodeVersion()` from the repository toolchain module passed under this
executable after the pins changed. No detached-signature verification is claimed;
the trust source here is the official HTTPS publisher checksum.

## Container pin

The official `library/node:24.21.0-bookworm` tag resolved to the immutable index:

`sha256:6dac556d980b7f0e5498d08f08cee0ca67798b4ad6c23964a9214920e67758d0`

The registry's advertised digest was checked against the downloaded index bytes,
then Linux arm64 and amd64 manifest and configuration digests were checked against
their actual bytes. Both configurations declare `NODE_VERSION=24.21.0`. The
official Dockerfile at commit `93a7bafc324a85ac1ee461604cff87cffacb6d7a`
also declares that version. Registry metadata and original source/config bytes
are retained beside `node-container-registry.json`.

CI's image pull, the moderation transport proxy/isolation fixture's `PROBE_IMAGE`
constant and its operator instructions now use that same index. No model sandbox,
networking, resource bounds, transport or cleanup behavior changed. The image has
not yet been pulled or executed during this lane; package metadata is not a
runtime execution result or a Debian package security audit.

## Integrated verification prepared, awaiting coordinator

After the dependency owner freezes both locks, root must rebuild accepted outputs
with the new runtime and preserve any failures. Existing artifact/build guards,
SDK and storage browser checks, CLI checks, Noir/Solidity fixtures, full Noir/TXE
and moderation tests retain their actual source deadlines. The changed image
also requires the real two-container Docker isolation tests with the same
assertions. A fresh isolated Linux build must independently compare every whole
generated output against the resulting native reference; old P04 hashes remain
historical evidence, not a substitute for this qualification.

Use the verified workspace `bin` first in `PATH` when invoking npm. No heavy
tests, build, image pull or container were started for this preflight. Root owns
the serial heavy-work slot. `node-pin-preflight.json` records the six owned
source hashes and pending acceptance work; package/lock changes belong to the
separate dependency lane.
