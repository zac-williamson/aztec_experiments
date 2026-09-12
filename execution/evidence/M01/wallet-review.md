# M01 wallet authority review

The repaired wallet-input boundary is consistent with the signer's two permitted
operations, `list` and `declare-immoral`. No unresolved model-controlled command,
wallet-path, operation, or destination override was found in the reviewed paths.
This is a delegated code review of another lane's changes, not an external audit.

## Checks and result

- The signer always supplies its frozen startup censor path. `list()` accepts no
  payload; `flag()` accepts exactly a bounded numeric post index and validated
  reason. The reason remains one argument, cannot start with `--`, and cannot
  supply another option. Process execution uses no shell and has fixed limits.
- The actual CLI passes `ACTION`, explicit-censor selection and all wallet paths
  to `loadCliWalletInputs`. For moderation, the returned censor object becomes
  both the Aztec account context and `config.censorWalletJson`; ETH credentials
  are null. The engine's declare-immoral branch uses this supplied object, so it
  does not fall back to another file. Its optional L1 signer check warns when no
  ETH wallet exists and continues; list/flag do not require borrowing one.
- Missing, unreadable, malformed or missing-key censor input fails without
  consulting ambient user/ETH wallet paths. Parsing diagnostics do not echo the
  wallet contents. Invalid field encodings can still fail later SDK validation;
  they do not cause authority fallback. Signer subprocess failure diagnostics
  suppress child stdout/stderr before returning to the daemon.
- An initial review found that administrative `transfer-censor` and
  `set-moderation-policy` still selected ambient wallets. The root lane extended
  the helper and tests to those actions. Their input selection now also uses only
  the censor wallet. This does not claim those complete administrative operations
  have been tested or repaired.

Validation: Node 24.15.0 ran
`node --test censor-daemon/test_wallet_authority.mjs censor-daemon/test_signer.mjs`:
**63 tests passed, zero failed**. Wallet tests use guarded fixture I/O; signer
cases use injected runners and harmless real argument-echo processes. No existing
user wallet was read, and no RPC call, proof, transaction or funded operation was
performed by this review.

## Remaining downstream finding

`apps/src/billboard/user/engine.js` still omits `set-moderation-policy` from its
`needsPXE` action list, while that action requires the initialized contract.
This is a source-confirmed administrative functionality defect assigned to M02's
policy integration work. It does not affect the two operations exposed by M01's
signer factory. Fixing wallet selection alone must not be represented as fixing
that complete administrative flow.

## Final fallback adjustment

The precommit review confirmed that the CLI default node endpoint is now
`http://127.0.0.1:5080`. The previous embedded endpoint is not reproduced here.
Explicit `--node-url` still takes precedence, so the signer's fixed startup
endpoint remains effective. This narrow fallback removal does not change
wallet-input selection or the supplied `censorWalletJson` wiring. The CLI hash
below reflects this final adjustment.

## Evidence limits

The tests verify input authority and process argument handling, not real-chain
authorization, successful transaction receipts, funding, privacy or proof
correctness. Configuration immutability means the startup path/value snapshot;
an authorized host administrator can still replace files. Isolation of the model
from host files is established by the separate runtime-isolation lane.

## Reviewed source hashes

| File | SHA-256 |
|---|---|
| `apps/src/billboard/user/wallet-inputs.mjs` | `95c0f88fa678b50de6d17526828b0c01f4ff2b01ffbbea142da4c866466ef1f7` |
| `apps/src/billboard/user/cli.mjs` | `b5427265bd24284d9ad7d7ebc25809f0802bdbb9bc8e3aee18796090a2d5a26b` |
| `apps/src/billboard/user/engine.js` | `77cee37194902eb0c2dc723307d82b8ef1d502c6ad139ff6f5395c3314fed48d` |
| `censor-daemon/test_wallet_authority.mjs` | `c7456ff3b8bdd27b9a26eb15ba4087fc5aa4481db1730dad1d15d895f55a0bd7` |
| `censor-daemon/signer.mjs` | `251e856ce7f8152ae453af6fb3edf1d8bf79ee8b2c35950c03b226da83e4657a` |
