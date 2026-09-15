# C03 — independent post identities and safe client retries

Production contracts now derive each real post's nonzero Field identity from a board-scoped nonce, without reading/reserving the public counter during private preparation. Public execution appends that identity to an inclusion-ordered index and records canonical content, byte length and inclusion time. Duplicate IDs reject. Dummy operations have empty content, ID0 and no public append. CLI, displayed order resolution and trusted moderation signer carry the stable ID exactly; model output cannot choose the target.

The wallet submits once, reconciles the exact transaction, and only prepares another proof after structured state-conflict validation and fresh state/hint reads. A real logical post retains its nonce across attempts. Ambiguous submission and failed inclusion fail closed. Dummy retries only handle a missing anchor; outer post/withdraw loops cannot override refusal or multiply retry budgets. Helper tests exercise actual used functions, not genuine same-note conflict proofs; that distinction remains explicit.

## Recorded checks

Repository: /Users/zac/Documents/ChatGPT/Anonymous Message Board/aztec_experiments. Pinned Node24.21.0, Aztec/Noir5.2.0 foundation; no dependency upgrade. Commands use the pinned local Node binary (or that binary first on PATH).

- `node scripts/build-contracts.mjs`: build-core-002.log passed; generated board artifacts match the compiled contract. Standard coverage warnings remain in the log.
- `node scripts/test-noir.mjs`: full-noir-tests-001.log,137 tests passed in412.27seconds. Includes22 migrated screening regressions and8 C03 controls. The ten-author TXE test is sequential, not the same-anchor evidence. Two Nargo test threads use the official isolated TXE sessions through one worker; overall540second bound.
- `node --test scripts/test-c03-post-client.mjs scripts/test-c01-user.mjs scripts/test-c01-deploy-activation.mjs censor-daemon/test_signer.mjs censor-daemon/test_moderation.mjs`: client-final-tests-007.log,174 tests passed,0failed.
- `node --test censor-daemon/test_daemon.mjs`: daemon-final-tests.log, integration entry point passed.
- `node --test scripts/test-c01-mining-clock.mjs`: mining-clock-tests.log, actual SDK clock regression passed.
- `node scripts/test-c01-application.mjs --posting-diagnostic`: application-725e6a89-b5d4-4651-85ac-c6ade9999794.json passed215638ms including cleanup. One-author diagnostic only, explicitly not concurrency qualification.
- `node scripts/test-c01-application.mjs --contention`: application-db6d60e3-d8cf-43a4-9c5d-e6f3a796c23c.json passed476849ms including cleanup, peak1521136KiB (about1.45GiB),10successful inclusions and10verified results. The application assertions finished464144ms. Each post proof/validation took12.37–12.78seconds.

## Genuine concurrency evidence

Ten fresh Aztec identities use ten actual portal deposits and genuinely proved/included claims. Ten real post proofs have byte-identical canonical anchor headers, pass normal node proof validation, and are all prepared before any is submitted. All ten succeed while public order advances. Independent SDK identity derivation matches the contract. Each original deposit nullifier, exact replacement DepositNote and PostNote, public content/length/time, canonical receipt and raw-block execution order is checked. The ten public IDs are unique; order equals actual execution order, not proof-preparation order.

The disposable node caps blocks at one transaction. This intentionally qualifies independent private preparation across changing public order, not network throughput. It still uses ordinary execution and genuine transaction validation. Official test-only Outbox settlement activates the local portal; no network prover or cryptographic epoch-finality claim. Parent540second/8GiB bounds remain; all owned descendants and temporary data were removed. Mining ended cleanly with maximum observed clock lead0seconds.

## Failure and repair history

The first ten-author attempt hit540seconds after submission; subsequent instrumented attempt finished502693ms with all ten pending after120seconds. A premature setup attempt was explicitly stopped after a checkpoint-edit failure. The one-author diagnostic then passed, isolating the batch-time dependency. A cap1 attempt still failed: eligible pending transactions, node clock about5seconds ahead of mined L1, and block initialization at frame+6.05seconds, beyond the final start cutoff at6seconds.

The local mining helper previously corrected the wall-clock-based TestDateProvider only forward. Loop/RPC overhead accumulated lead over mined time. It now aligns to every mined timestamp in both directions. A deterministic300iteration SDK-clock test reproduces7seconds lead under the old policy and aligned samples with the correction. The unchanged ten-author/cap1 profile then passes with zero lead. Failed records and diagnostic notes remain retained; reducing block size alone was not the repair.

## Source binding and limits

source-clock-fixed.json fingerprints the accepted application. Production contract, migrated Noir tests and client/signer sources remained unchanged after their recorded checks; subsequent reviewed changes added harness observations, the diagnostic profile and clock repair. The final genuine runner verifies its source hashes and actual compiled artifact inputs before/after execution. Final integrated review records these deltas and the runtime disposition.

C04 history lookup beyond16/32/1000 and C05 policy/deadline/penalty/exit semantics remain separate required production work. No policy version/event is fabricated here. Same-note real-world retry, broader fee availability, long-history liveness and final release-wide integration remain downstream validation. Internal AI review is not an external audit. This completes the counter-contention package, not production readiness.
