# P04 derived CRS — independent implementation review

Reviewed on 2026-09-12 by the delegated verification agent, separately from the build and runtime implementation agents. This is an AI source/test review, not external cryptographic assurance. Only this review file was written by the reviewer.

## Disposition

No unresolved implementation finding in the reviewed derived-CRS changes. One HTTP-response cleanup issue found during review was corrected with discriminating regression controls. Final integrated derivation, browser, and independent clean-build evidence remain separate requirements; this review does not mark P04 complete.

The trust boundary is coherent: the application receives its manifest from the reviewed source build, not from a CDN or mutable cache. Cached/local/remote bytes are untrusted and must match the entire manifest-pinned content. Runtime accepts the derived digest from that trusted manifest; the build validator additionally fixes the observed full derived digest. These checks do not protect against compromise of the application's own trusted source/build or a hostile script already executing inside its page.

## Source assessment

- **Input identity and format:** schema 2 keeps the original three downloaded assets and introduces a separately named derived asset. Final build and runtime validators agree on source counts, exact lengths, formats, official origins, and ranges. BN254 retains 1,179,648 points: 37,748,736 compressed input bytes and 75,497,472 derived bytes. G2 remains 128 bytes; Grumpkin remains 65,537 points / 4,194,368 bytes. The existing download-size ceiling was not broadly relaxed for the larger local output.
- **Whole-content verification:** the worker checks compressed input/G2 sizes and hashes, package pins, and the exact pinned WASM gzip bytes before selecting `BackendType.Wasm`. It requires a byte-array result and verifies its entire fixed-size SHA-256. The parent accepts output only after successful child closure and repeats full verification. Existing cache hits are also fully verified. Runtime hashes the complete derived file before initialization, including all points beyond the first two; it does not rely on the weaker internal uncompressed-path checks or a hash stored alongside cache bytes.
- **Provenance:** the manifest binds method `bb-srs-init-v1`, package version, compressed input digest, G2 digest, count/format, exact gzip path/hash, and output hash. The gzip digest is not represented as the decompressed-WASM digest. JavaScript derivation glue is bound by the source inventory and review hashes below, not by a glue-source hash embedded in the manifest. Final release evidence must retain that source binding.
- **API results:** the selected trusted format determines the response invariant. Compressed initialization must return 75,497,472 bytes; already-uncompressed initialization must return an empty byte array. Missing output, non-byte element types, and mismatched lengths fail before Grumpkin initialization. Grumpkin success requires `dummy === 0`. This matches the actual full-size 5.2 experiment and the pinned SRS API semantics recorded in `crs-startup-options.md`; it is not inferred merely from a successful stub.
- **Fallback:** missing, wrong-size, or same-size corrupt local derived bytes select the original compressed path, with its original local/CDN checks. Corrupt derived bytes never reach the prover. Failure of both representations fails before initialization. A derived entry cannot add an arbitrary remote URL. Frozen metadata snapshots prevent loader callbacks from changing the selected pin or its provenance. A prover initialization error itself fails; the implementation does not report a partially initialized instance as ready.
- **Bounds and cleanup:** downloads stream under exact byte bounds and 120-second abort signals. CLI local reads check file size before loading; browser local reads use the same bounded response reader. The build worker has an external 600-second deadline because synchronous WASM cannot service an in-process timer. Normal timeout/interruption paths kill the child, observe closure, and restore signal listeners. If the OS fails to report closure after SIGKILL, the exceptional path explicitly reports failure after the additional three-second bound; unconditional reaping cannot be claimed for that exceptional path. Unique temporary outputs are removed in `finally`; atomic writes re-read and verify the temporary bytes before rename, preserving prior output on failed promotion.
- **Output coverage:** `apps/build.mjs` verifies all four provisioned files before generating pages. `scripts/check-reproducibility.mjs` includes every byte of `g1_uncompressed.dat`, the original three files, and the copied CRS manifest in exact output comparisons. This establishes comparison coverage, not that a new independent comparison has already passed.
- **Actual consumers:** source inspection confirms both browser adapters and all three CLI adapters use the shared helper. The browser smoke-test change captures actual `srsInitSrs` input size/count through a forwarding proxy and asserts the provisioned derived representation for each browser consumer. It cannot silently accept a compressed fallback as the intended derived-path qualification; it does not substitute bytes or prover responses. Existing qualification time budgets remain unchanged.

## Finding and verification evidence

The reviewer identified that `readResponse` rejected a bad HTTP status before cancelling its response body. A non-ending error stream could remain active while fallback began. The runtime agent corrected this with best-effort cancellation before propagating the original HTTP status. Source review confirms the correction. Two targeted controls verify a non-ending 404 stream is cancelled and that a cancellation failure preserves the original 503 error. See `derived-crs-cancellation-results.json` and its retained log.

The reviewer independently ran:

```text
/Users/zac/.nvm/versions/node/v24.15.0/bin/node --test scripts/test-crs-build.mjs scripts/test-crs-consumers.mjs
```

That run passed **84/84**, zero failures/cancellations/skips, in 13,559.845459 ms (session 13844, exit 0), on the earlier 28-build/56-consumer-test snapshot. It preceded the final five build-schema controls and two cancellation controls and is not claimed as a final-source full-suite run. The build agent subsequently recorded **33/33** for its final source in `derived-crs-build-implementation.json`; the runtime agent recorded **2/2 targeted cancellation checks** for its final source. Those saved results were inspected. The final 58-case consumer suite/integrated checks are reserved for root after its serialized cold derivation, avoiding concurrent heavy work.

The corruption controls use synthetic production-sized byte buffers and stubbed prover calls. They meaningfully test full-byte hashing, corruption past the first two points, fallback, and format-specific result rejection; they are not curve-valid setup/proof evidence. Web Crypto tests execute the complete helper in a Node VM, not an actual browser. Filesystem controls cover corruption, failed rename, and temporary-write mutation. Lifecycle controls launch real disposable child processes and check disappearance after timeout/interruption.

The separate retained experiment (`crs-experiment-review.md`, derive/uncompressed JSON and runner copies) used actual pinned 5.2 WASM in fresh processes and the complete setup. It observed the same derived digest and the specified nonempty/empty response difference. It was a single local initialization experiment, not a benchmark guarantee, independent fresh derivation, browser pass, or application proof. Root's new cold production-worker run and renewed browser/Linux comparisons must supply their own evidence.

## Reviewed final source hashes

| Path | SHA-256 |
| --- | --- |
| `crs-manifest.json` | `4927de3e03d69f4e640a841f9421dd0b93819b5e3d42c142d12ee079d5a402be` |
| `scripts/build-crs.mjs` | `7690ba2f0e983e6329fada97ac5a05479bb38cf44da122c6b7f6560bfec8f178` |
| `scripts/derive-crs-worker.mjs` | `9f05e64330534d86bcf57e3149116c5be30a1d798495b11d2da18538ebb1a7f8` |
| `scripts/derive-crs-process.mjs` | `15cd61d8fab0f59d97e14d9846ecb747491da5f2858963354a11b7b8b696e322` |
| `scripts/test-crs-build.mjs` | `bda7955498ca2097671742df922f23a3e9fe906ef879b1b5db2a1230e5dcec06` |
| `shared/crs-client.js` | `d2f05e23a00be052861eab920d8e1673767028256fceb825d1c7ee70b91e193a` |
| `scripts/test-crs-consumers.mjs` | `96978940e6f709757272a6ac80db603d5d418961b9e11be19d0110a98c2e2e85` |
| `apps/build.mjs` | `7dc87738832541b0f393c67b01673b0279e7c8029f8b50d1d85fa6934679fcd5` |
| `scripts/check-reproducibility.mjs` | `c83683b064335548d6cf058ffc1a9d369aba5853eff791ba1d40ca792fd13885` |
| `scripts/test-sdk-browser.mjs` | `ae0a5de7e8ab542e9f37e46b4cee5670f2c083b4552c8925ccb1daeb34c6e0e3` |

These hashes were read from the final files after the agents' correction notifications. Further changes require affected review/verification. No application edits, public transactions, real-wallet use, browser/prover run, or external assurance claim were performed by this review lane.

## Integrated evidence received after source review

Root subsequently completed the production `build:crs` with the derived target and derived cache absent, using the verified compressed sources. Root reported successful new-worker derivation and exit 0; the retained output log inspected by this reviewer confirms all four exact byte counts and the full derived digest `2aefa0bc53704a61d887ff316d56b6f8bed968859b8b894c3677f11797779dac`. Absence of the derived cache at invocation is root's execution observation; the output log alone would not distinguish a derivation from a valid cache hit.

Root then assembled the applications and ran integrated `test:build`: **171/171 passed**, zero failures/cancellations/skips, 16,999.594208 ms, session 68833 exit 0. The saved log was inspected; this includes the final **33 build / 58 runtime** controls and supersedes the earlier pending full-consumer verification statement. Relevant final source hashes were rechecked and remain identical to the table above. No duplicate test run was launched by the reviewer.

The new reproducibility snapshot contains **34 exact output hashes**, including all derived G1 bytes with the expected digest. A snapshot is not itself an independent-build comparison. Actual browser qualification is running separately at this update; no browser result or fresh Linux comparison is claimed here.

| Root evidence | SHA-256 |
| --- | --- |
| `derived-crs-root-build.log` | `7fdfd47b08ff547ea67960b51ad89b4507fa23943efe3d3359a27f7b03ca8078` |
| `derived-crs-app-build.log` | `cd575e498ac8d8d5697782b0cf7eb092d1eedc83210e8be6ae2ff8e5f0839bab` |
| `derived-crs-integrated-build-tests.log` | `8f0ee5bf765231f67f0747ad4d7c223e0a968794cb9eea6ed5895645c14ba26e` |
| `derived-crs-root-output-hashes.json` | `f0f24b0338535d0e20c7b290155fad29f6bf7ccfa0222380b85350039e3cfb30` |
