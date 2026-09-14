# C01 test-only ACVM adapter checks — authored, not executed

2026-09-14. This is a maintained compatibility test for the genuine WASM witness adapter, not native ACVM, a proof test, or application cryptographic assurance. Root owns serial execution and result integration. No compiler, adapter, tests, downloads, or proof jobs were run in this authoring lane.

Source frozen:

- `scripts/test-c01-acvm-adapter.mjs`: SHA256 `13a37f7ae4afec46e8d79101e3b250d8ac091a6ad4781d128129091022b180ac`
- Adapter reviewed: `scripts/c01-acvm-wasm-cli.mjs`: SHA256 `aca8470c324e3d4ab8440d6e6243d05c0b550838c92273bcb122b9ee22231cb9`

## Actual interfaces and controls

The suite compiles two fresh standalone Noir programs with the maintained pinned nargo helper (version and commit checked; executable SHA256 recorded). Neither program has dependencies. The normal program constrains `x != 0` and returns `x*x`; the second invokes a genuine oracle through an unconstrained function and constrains its returned value to equal x before returning its square. Thus the foreign call participates in the result and constraints.

Ten sequential cases cover:

1. Actual ABI-encoded x=3 input, successful adapter execution, strict native double-quoted stdout parsing, actual `decompressWitness` on `output-witness.gz`, equality of every stdout/gzip witness entry, and actual ABI decoding of both representations to x=3/result=9.
2. Zero input rejected by the compiled nonzero constraint.
3. Constraint-bound foreign call rejected with `FOREIGN_CALL_FORBIDDEN`, without a supplied oracle result.
4. Duplicate witness index rejected.
5. Modulus-valued (out-of-field) input rejected.
6. Shortened hexadecimal input rejected.
7. Working directory outside the allowed scope rejected.
8. Input symlink to a dummy file within the same disposable tree rejected.
9. Missing explicit allowed root rejected.
10. Unsupported argument list rejected.

Every negative case requires ordinary exit 1, empty stdout, only the fixed sanitized error format, and absence of output-witness.gz. Timeouts or crashes are failures, not accepted negative results. The normal case supplies a meaningful nonempty control rather than relying only on the existing empty padding witness.

## Execution and evidence

Root command with the pinned Node 24.21.0 bin directory first in PATH:

```sh
node --test scripts/test-c01-acvm-adapter.mjs
```

The suite uses one 120-second test deadline, 30-second per-compiler deadlines and 5-second per-adapter deadlines, with SIGKILL for child deadlines. It creates its private tree under `/private/tmp/c01-adapter-test-*`, scopes each adapter working directory beneath a separate mode-0700 child, uses a minimal child environment, and recursively removes the entire owned tree in finally. It performs no network or wallet operations. The parent may additionally supervise the test command. This small suite does not implement an OS memory cap or adversarial same-UID filesystem isolation.

Each invocation produces a unique `execution/evidence/C01/acvm-adapter-tests-<uuid>.json`. It records source hashes before/after, compiler hash, source/artifact fingerprints, case outcomes, child exit/deadline observations, stream lengths/hashes, and cleanup status. Raw compiler/adapter streams and witness values are not written to evidence. Scenario errors are replaced with fixed messages to prevent upstream ABI/ACVM error rendering from printing witness data. All inputs are disposable test constants.

Source inspection supports the intended interface agreement; compilation, oracle retention, deadlines, and all ten outcomes remain unverified until root executes the suite. No package scripts, dependencies, adapter implementation, or production code were changed in this lane.
