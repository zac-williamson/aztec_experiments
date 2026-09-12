# P02 CRS provisioning verification

Executed by the delegated build review lane with Node v24.15.0. No existing wallet, remote RPC, funding, transaction, or proof generation was involved. Exact commands and outputs below were transcribed from successful tool results in this session; they are not a captured shell transcript.

## Source and formats

Pinned npm package `@aztec/bb.js@5.0.0`, `dest/node/crs/net_crs.js`, SHA-256 `98182144b264c587733e40e5ed22446d704af132eb36ed0b02b307a99cda4da5`, selects the official hosts and `g1_compressed.dat`, `g2.dat`, `grumpkin_g1_v2.dat`. Browser `barretenberg/index.js` initializes these formats and uses default point counts of 524288 BN254 and 65536 Grumpkin. The application's previous BN254 count 1048577 is rounded up to 1179648 to retain capacity and meet compressed ingress 4 MiB chunk alignment; Grumpkin remains 65537. Production proof capacity remains a later measured gate.

`crs-manifest.json` records exact URLs, byte ranges, lengths and SHA-256 pins. Hashes were calculated from bounded official primary-host downloads, not represented as a separate publisher checksum attestation.

## Official download and fresh provisioning

Command:

```sh
/Users/zac/.nvm/versions/node/v24.15.0/bin/node scripts/build-crs.mjs .build/crs-ready
```

This was the first invocation with an empty `.build/crs-cache` and a fresh destination. Result: exit 0.

```text
Verified CRS g1.dat: 37748736 bytes, SHA-256 8d6fb7829bcfbfeaf02a79104539bfd3777a328ec46d3331e37effca2ee1b416
Verified CRS g2.dat: 128 bytes, SHA-256 01797bfc4de5a96f0e516a9ea4537d18786dc30cb991aca4274c95822b69c32f
Verified CRS grumpkin_g1.dat: 4194368 bytes, SHA-256 b4988c0ae3dd058b781045aeb70000d7b7fb5ffe557ed4f81c64b437c39a61c9
```

Prior direct network observations were HTTP 206 with exact Content-Range:

```text
g1_compressed.dat bytes 0-37748735/3200000000 length 37748736
g2.dat bytes 0-127/128 length 128
grumpkin_g1_v2.dat bytes 0-4194367/16777216 length 4194368
```

## Offline restoration

Executed the following module with the same Node executable:

```js
import {buildCrs} from './scripts/build-crs.mjs';
import path from 'node:path';
import {ROOT} from './scripts/toolchain.mjs';
globalThis.fetch=()=>{throw new Error('Network forbidden in cache restoration test')};
await buildCrs(path.join(ROOT,'.build/crs-restored'));
console.log('Fresh output restored from checksum-verified cache with network disabled.');
```

Result: exit 0, the same three verified length/hash lines, followed by `Fresh output restored from checksum-verified cache with network disabled.`

## Matching WASM initialization

Direct downloads were stored under `.build/crs-review/` with their remote names. Executed with the same Node executable and `--input-type=module`:

```js
import {BarretenbergSync,BackendType} from '@aztec/bb.js';
import fs from 'node:fs';
const bb=await BarretenbergSync.new({backend:BackendType.Wasm});
try {
  const bytes=f=>new Uint8Array(fs.readFileSync('.build/crs-review/'+f));
  const result=bb.srsInitSrs({pointsBuf:bytes('g1_compressed.dat'),numPoints:1179648,g2Point:bytes('g2.dat')});
  console.log(JSON.stringify({bn254:'initialized',uncompressedBytes:result.pointsBuf.length}));
  bb.srsInitGrumpkinSrs({pointsBuf:bytes('grumpkin_g1_v2.dat'),numPoints:65537});
  console.log(JSON.stringify({grumpkin:'initialized',proofGenerated:false}));
} finally {await bb.destroy();}
```

Result: exit 0.

```json
{"bn254":"initialized","uncompressedBytes":75497472}
{"grumpkin":"initialized","proofGenerated":false}
```

This exercises the actual pinned WASM SRS initialization API in Node. It is not a browser execution or proof-generation result.

## Baseline disposition

Baseline `g2.dat` matches the official pinned data. Baseline `g1.dat` was uncompressed but is compatible: after decompressing the official new download through the pinned WASM API, SHA-256 of its first 67108928 bytes equals the old baseline hash `0f238856e55722f15a4d64ef0de12b4260e218245590bd3a6c900aee188de8e5`. Therefore the previous BN254 data is not being classified as incorrect; it lacked build provenance and used a larger wire format.

The baseline `grumpkin_g1.dat` hash was `8df01ac0f564db0b52857d37b363b8f8042cd1d886f8d8fd2677375a6290e870`, differing from V5's selected `grumpkin_g1_v2.dat` bytes. The provisioned release now uses the file selected by the pinned V5 SDK.

## Repeatable response regression tests

```sh
/Users/zac/.nvm/versions/node/v24.15.0/bin/node --test scripts/test-crs-build.mjs > execution/evidence/P02/crs-build-tests.log 2>&1
```

Result: 7 passed, 0 failed. Tests cover the correct response, ignored Range, wrong Content-Range, oversized and truncated bodies, wrong digest, and fallback accepting only the same pinned content. These tests use small synthetic HTTP responses to validate downloader rejection behavior; the separate successful real downloads above verify actual official source compatibility.
