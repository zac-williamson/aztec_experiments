# BaseParity harness source handoff

2026-09-14. New source only; no execution, syntax check, download or proof in this lane. Passing padding harness remains unchanged. New source `scripts/test-c01-base-parity-proof.mjs` SHA256 `4b335511318d84a29e903ce83c2427ab8bed159e5c860b645036cd09f8a28ac8`. Root owns setup preparation and the first authorized bounded run.

## Inputs and intended assertions

The harness uses exact pinned5.2 BaseParity artifact/VK and native BB, `ultra_honk` (non-ZK, no IPA accumulation), one native thread, and requires native reported domain4194304. A deterministic asymmetric256-message batch and two different metadata fields produce independently reduced SHA and Poseidon trees. SHA node encoding is zero || first31bytes(SHA256(left32BE || right32BE)); Poseidon uses the actual SDK primitive with separator2982624097. This independent tree implementation does not call the circuit's output function. SDK Poseidon runs through an explicitly configured one-thread WASM singleton with no SRS initialization; that runtime is destroyed before native proof startup.

Both a changed-leaf witness and the original witness execute the actual installed circuit, and all four decoded outputs must equal independently derived roots/metadata. Changed leaf173 must change both roots. The changed witness is cleared before the original is computed, and the original witness map is cleared after compression. Only the original gets a native proof. Its four public input fields must equal the independent expected values. Native verification must accept it, reject a changed public root, reject a changed canonical proof field with unchanged field count, and accept the original again. Exceptions/crashes do not count as successful negative controls. Fresh test public roots, count/hash and timings can enter evidence; no witness/full proof/private identity dump is retained.

## Setup integrity and network boundary

Root preparation supplies `.build/C01-parity-crs/manifest.json` schema1 and33 complete4MiB compressed chunks (138412032bytes,4325376points). The harness independently verifies exact shape, source URL, BB hash,33 hash strings, frozen first33 hash transcript SHA256, and occurrence of the complete1056-byte transcript in the exact pinned binary. It streams each4MiB chunk through SHA256, verifies the whole-file checksum, stages only verified bytes into a fresh private directory, and repeats chunk checks over the staged copy. After the worker exits it checks these immutable compressed bytes again. The passing project manifest separately pins local G2 and Grumpkin.

No global cache or network download is used. Worker/native descendants retain Seatbelt IP denial and must pass the actual EPERM/EACCES local network control. The CRS directory permits writes only to native `bn254_g1.dat` and `crs.lock`; compressed/G2/Grumpkin files remain immutable. Native normal cached-compressed loading derives the uncompressed file, avoiding the partial-chunk BB_VERIFY_CRS pitfall. Source setup hashes independently enforce the compiled-in chunk pins before that derivation. Derived size must be positive,64-byte aligned and no larger than4325376points; record its byte count and streamed SHA256 then remove the temporary assets. This is observed provenance only after a successful run, not an existing claim.

## Supervision

The existing300second worker budget and310second supervisor fallback remain. Parent TERM/KILL group cleanup is bounded; final success requires group absence, normal exit, all API assertions, post-run fingerprints/setup checks and directory removal. Child NODE_BACKEND=js and safe error class/code/stack-location metadata retain root's qualified padding fixes. Resource output from `/usr/bin/time -l` remains separate from Node resourceUsage.

New parent RSS supervision runs macOS `ps -axo pid=,pgid=,rss=` immediately and approximately every second (no overlapping calls, each call limited to2seconds/4MiB output). It records only members of the owned process group and their summedRSS KiB, sample times and peak. A sample at or above **8388608KiB (8GiB)** requests bounded group termination and marks failure. Sampling errors, malformed output, a live group without rows, or no successful samples cannot pass. The limit is an explicit experiment stopping rule, not a hardware requirement or an OS-enforced allocation limit: memory can change between samples, and shared pages may be counted more than once. No cap increase or retry is automated.

## Review/qualification still required

Root should review and syntax-check the new source before one isolated run. The new changed-input circuit workload, offline writable-derived profile, resource sampler and manifest interface are unexecuted here. Any setup/API/resource/timeout failure must be retained. Success measures a real nontrivial server circuit on this host; it does not complete C01 board proving, recursive epochs, genuine L1-verifier/Outbox acceptance, or production readiness.

Root review: syntax check passed; reviewed the changes against the previously
qualified padding supervisor. The pinned native socket backend spawns BB without
a separate process group, so the owned group contains the worker and native
prover for RSS sampling/cleanup. Full chunk checks precede native derived-cache
writes; immutable inputs are checked again afterward. First bounded execution
is now in progress; no success is asserted in this review note.
