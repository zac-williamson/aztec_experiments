# P04 actual full-size uncompressed CRS feasibility experiment

**Both actual 5.2 WASM initialization paths passed in fresh Node processes.** This was one bounded feasibility experiment, not a browser benchmark, proof, production change, repeated performance sample or clean-build reproducibility qualification. Root held other project heavy runs. No application manifest/source or setup point count changed.

## Invocation and bounds

From the repository root, executed `python3 .build/P04-crs-experiment/supervise.py`. The supervisor launched `/Users/zac/.nvm/versions/node/v24.15.0/bin/node .build/P04-crs-experiment/run.mjs derive` followed by the same runner in `uncompressed` mode, each as a new process. Both explicitly called `BarretenbergSync.new({ backend: BackendType.Wasm, wasmPath })` with the concrete installed 5.2 WASM path, avoiding the native-backend fallback. The supervisor applied one shared 600-second limit and would kill/reap a timed-out child. Both children instead exited0 naturally; total 124.235 seconds. Session 8812 completedexit 0. Each runner destroyed its instance; no owned experiment process remains active.

The executed runner and supervisor are retained verbatim in `crs-experiment-run.mjs.txt` and `crs-experiment-supervise.py.txt`. These copies preserve the invocation's source; they are not production scripts. Exact child commands/outcomes are in `crs-experiment-supervision.json`.

## Setup identity and output

Before initialization, the runner required Node 24.15, all installed Aztec package pins, manifest 5.2, exact sizes and full SHA-256 checks for the inputs. BN254 used all 1,179,648 currently provisioned points, without a capacity reduction.

- Compressed G1:37,748,736bytes, SHA-256`8d6fb7829bcfbfeaf02a79104539bfd3777a328ec46d3331e37effca2ee1b416`.
- Derived uncompressed G1:75,497,472bytes, SHA-256`2aefa0bc53704a61d887ff316d56b6f8bed968859b8b894c3677f11797779dac`.
- G2 remained128bytes, SHA-256`01797bfc4de5a96f0e516a9ea4537d18786dc30cb991aca4274c95822b69c32f`.
- Grumpkin remained65,537points /4,194,368bytes, SHA-256`b4988c0ae3dd058b781045aeb70000d7b7fb5ffe557ed4f81c64b437c39a61c9`.
- Manifest SHA-256`485de34aa39dde1a5683921ce6c4f614774f64bc453568300020a36d776c3891`.
- Installed `@aztec/bb.js@5.2.0`, concrete `dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz` SHA-256`9106f6164e4714a87ce1cf13ceac4d22109767a16e6fb997f1af7e7fcc81ae45`; decompressed actual WASM SHA-256`393343a62aabf19e21c33b445f7d61188a62a81cd8562f68cb0616329336365e`.

The first process initialized from the complete verified compressed prefix, required the full 75,497,472-byte return, hashed it and wrote `.build/P04-crs-experiment/g1-uncompressed.dat` with exclusive creation. The second process checked the same manifest/WASM identity, reloaded and full-hash-verified that derived file, initialized with the same count/G2, and required the documented **zero-byte** response. Both initialized the unchanged Grumpkin bytes and required `dummy === 0`.

For reproducible follow-up, the full compressed input, G2 and Grumpkin are also retained in the ignored experiment directory, copied after the experiment with fresh full size/hash checks. Derived bytes were checked again on disk. The stored output digest is an observed derivation result; independent fresh derivation and cross-platform comparison are still required before treating it as a release artifact pin.

## Actual measured times

| Operation | Compressed process | Uncompressed process |
|---|---:|---:|
| Fresh WASM instance |861ms|403ms|
| BN254 initialize call |118,910ms|1,873ms|
| Unchanged Grumpkin initialize |141ms|115ms|
| Returned BN254 bytes |75,497,472|0|

These are wall times around each actual API call, on Node 24.15/darwin-arm64. Input loading and hashing occur outside the BN254 call; the compressed call includes its internal hashes, decompression, serialization and CRS setup. No attempt was made to separately time those internal operations. The distinct processes and unequal input sizes also produced different allocation patterns: raw `process.resourceUsage().maxRSS` was 447296 for derivation versus 654176 for uncompressed initialization. The raw resource records are retained without treating this one sample as a memory/performance guarantee.

The result justifies a controlled browser experiment and a maintainable build-derived artifact pipeline. It does not establish browser startup time, low-memory-device suitability, actual proof capacity or correctness of future cache code. Production adoption still needs full derived-asset hash verification, explicit input-format response handling, corruption tests after the first two points, bounded provisioning, independent regeneration and renewed browser/build evidence. It does not explain or resolve the earlier pre-SRS page navigation failure. No browser was launched during this experiment.

## Evidence fingerprints

- `crs-experiment-derive.json`: SHA-256 `b9aa3faef5a69d612eda53f4069a9ecdf23089382e141c3ae7b0b48b43b32be5`.
- `crs-experiment-derive.stderr`: SHA-256 `ffde6ac9bf8563346c6e6ccc368310874d49e70860aedad1ab998f7ba80c024a`.
- `crs-experiment-derive.stdout`: SHA-256 `b9aa3faef5a69d612eda53f4069a9ecdf23089382e141c3ae7b0b48b43b32be5`.
- `crs-experiment-run.mjs.txt`: SHA-256 `cd116756992b84f5dfbc39bacfa21266aba76731621a8990423b251171e37f4e`.
- `crs-experiment-supervise.py.txt`: SHA-256 `4b8063fe394cbb2dfd6d59200aa6496f9766669c19824c92877f9e3a4b99173a`.
- `crs-experiment-supervision.json`: SHA-256 `4a09ad000f1dda70ea8cf47c48821a967634b827d380548d082041ee84ed5ded`.
- `crs-experiment-uncompressed.json`: SHA-256 `4ffa7c848a97c8d403176ef77a9fa37b5fd05661b5cba1acc7cddd385f277c5b`.
- `crs-experiment-uncompressed.stderr`: SHA-256 `fbc2902f32cbcf9793dc11770c5251929c13adcc0bafd2ff4e4f6429c03509f1`.
- `crs-experiment-uncompressed.stdout`: SHA-256 `4ffa7c848a97c8d403176ef77a9fa37b5fd05661b5cba1acc7cddd385f277c5b`.
