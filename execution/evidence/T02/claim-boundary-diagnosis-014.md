# Claim boundary failure diagnosis and test isolation repair

Date: 2026-09-18. Failed run retained: `application-9a30a5ad-7d6c-4334-a3a7-69b9903158a5.json`.

The malformed authentic sibling probe correctly failed the Noir membership constraint.
The subsequent legitimate claim failed because the same PXE retained the deliberately
corrupted witness in its immutable-read cache. This is test-induced cache contamination,
not evidence that genuine application membership validation is broken.

Installed Aztec 5.2.0 source establishes the mechanism:

- `node_modules/@aztec/pxe/src/pxe.ts:322` wraps the supplied node proxy in `withCache`.
- `node_modules/@aztec/pxe/src/node/caching_aztec_node.ts:120` caches Inbox witnesses by block hash and message hash.
- `AztecNodeCache` retains fulfilled fetches; a later circuit rejection does not reject that already fulfilled fetch.
- `node_modules/@aztec/pxe/src/block_synchronizer/block_synchronizer.ts:169` wipes on anchor updates; a same-anchor sync does not ensure invalidation.

The test helper now disarms the injection, explicitly wipes the pinned SDK's cached
node, and requires exactly one source read plus exact canonical index/path equality
through that cached wrapper before proceeding to the legitimate claim. This uses
`wallet.pxe.node`, a TypeScript-private but runtime-accessible SDK property, exclusively
inside test code. A missing reset seam, ineffective reset, or noncanonical response
fails the test. No application behavior, circuit constraint, proof verification or
network settlement behavior changes.

Lightweight regression uses the actual installed `withCache`, `BlockHash`, `Fr` and
`SiblingPath`, with a one-sibling disposable source fixture. It reproduces persistence
of the corrupted value after disarm, verifies restoration and immutable source buffers,
and checks failure for ineffective reset and noncanonical membership. All three tests
passed with pinned Node 24.21.0 in under one second. This is a cache-isolation regression,
not proof qualification; the full genuine application journey still requires rerunning.

Relevant fingerprint additions for the genuine harness:
`node_modules/@aztec/pxe/src/node/caching_aztec_node.ts`,
`node_modules/@aztec/pxe/dest/node/caching_aztec_node.js`,
`node_modules/@aztec/pxe/src/pxe.ts`,
`node_modules/@aztec/pxe/dest/pxe.js`,
`node_modules/@aztec/pxe/src/block_synchronizer/block_synchronizer.ts`,
`node_modules/@aztec/pxe/dest/block_synchronizer/block_synchronizer.js`,
and `scripts/test-t02-claim-boundary.mjs`; retain the existing helper fingerprint.
