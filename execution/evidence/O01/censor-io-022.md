# Censor command IO checkpoint 022

Implemented `scripts/o01-censor-command-io.mjs` and `scripts/test-o01-censor-command-io.mjs`. No live Aztec node, proving, deployment or package build was run.

## Interfaces

`openO01CommandRpc({node})` exposes loopback-only POST RPC using the installed official `AztecNodeApiSchema` and namespaced JSON-RPC implementation. It wraps the existing `sendTx`, preserving its receiver/arguments and actual acceptance behavior. Only successful original calls populate `captures: Map<publicHash, Tx>` with an independent serialized copy. Duplicate hashes are rejected before another underlying submission. The map is in-memory evidence, not public output. Close restores the prior method, releases pending RPC waits, closes owned sockets and removes server ownership. Closing a wrapper does not cancel the underlying node's genuine verification; the node remains owned by the enclosing fixture.

`runO01PackagedCommand({packageRoot,args,directory,timeoutMs=120000})` invokes the actual package's `scripts/operator-launch.sh` with an argument array and isolated HOME/TMPDIR/PATH. Arguments start with `author`, followed by the existing CLI action and flags. It returns only `{code,txHashes,markers,elapsedMs}`. Stdout and stderr have separate bounded partial-line parsers; no raw errors, policy text, argument values or stack traces cross the result boundary. One MiB total output / 4096-character lines are bounded. Timeout/output failure triggers owned process-tree cleanup. The enclosing qualification owns the aggregate 540-second / 2-GiB limits.

Recognized positive markers are `TX_CONFIRMED`, `MODERATION_POLICY_UPDATED`, and `NEW_CENSOR_ON_CHAIN`; these are diagnostic only, not canonical success evidence. Fixed operational failure markers include `CENSOR_READ_UNAVAILABLE`, `PRIVATE_FEE_FAILED`, `COMMAND_FAILED`, `TIMEOUT`, `OUTPUT_LIMIT`, `SPAWN_FAILED`, and `SIGNAL_EXIT`.

**No authorization-rejection marker exists:** current CLI sanitization turns an old-censor failure into generic/private-fee failure. A nonzero command alone cannot establish exact authorization rejection. Native authority/receipt/state assertions must determine what was proved.

## Lightweight verification

Pinned Node test run: 5 tests passed, approximately 1.62 seconds.

- Actual official-schema HTTP client reads the fake node and submits a serialized transaction; original node is called once, accepted capture bytes/hash match, duplicate is rejected, prior method is restored.
- Failed original send does not populate captures; closing the server disposes an actual hanging HTTP request.
- ANSI/timestamp log parsing retains exact public hashes and fixed messages, separates stderr fragments and omits secrets/unrecognized errors.
- Actual tiny child launcher verifies literal shell-looking arguments and isolated environment; returned evidence omits secret stderr.
- Hanging and excessive-output child processes are terminated and their owned groups verified absent.

These process tests use an explicitly disposable launcher fixture to test transport/supervision. They do not claim a real packaged censor transaction. Initial test execution exposed a random-transaction test hash mismatch (official RPC reconstructs the hash) and an oversized complete-line overflow detection gap; the test now recomputes its synthetic transaction hash and the parser rejects oversized complete lines. Final tests pass without weakening acceptance/cleanup assertions.
