# Browser integration milestone 028 — incomplete application qualification

The pinned SDK wallet scope API mismatch is fixed in all three adapters.
The browser now initializes its actual asynchronous proving worker with verified
local CRS and two threads; it does not keep duplicate proving setup in the
synchronous hashing worker or invoke automatic CDN setup downloads.

Supported upstream msgpackr no-eval entrypoints and Zod interpreter mode remove
optional eval probes without changing CSP. Browser recovery now refreshes verified
account state and safe navigation without automatically claiming another deposit.
Setup errors explain reload and recovery.

## Checks on candidate 028

- SDK build: success, sampled peak989360KiB, owned process tree absent.
- Integrated focused suite:155 passing checks.
- Actual HTTPS setup:3968ms overall,1112752KiB sampled aggregate peak;765ms
  asynchronous proving setup,239ms hashing,837ms wallet SDK navigation readiness.
- Actual prover received524288 BN254 points /33554432 uncompressed bytes, after
  whole-file verification of75497472 bytes/1179648 points. G2/Grumpkin unchanged.
- HTTPS isolation, workers, writable private storage, encrypted wallet creation,
  zero external requests and owned-resource cleanup pass.
- Genuine browser post028 stopped at2379664KiB after221875ms; all owned resources cleaned. No browser proof qualified.

The raw reports carry exact source hashes and observations. Timing is one local
measurement, not a representative-device performance qualification. Prior failed
browser reports remain preserved, including026's aggregate memory-limit stop.
No production readiness, model approval, external review or network clearance is
claimed. U01 remains active.
