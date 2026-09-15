# W02 wallet/key/recovery audit

Read-only source review at W02 start. Findings were sent to root and are not claims about the final repaired source. No real wallets, signatures or keys were used; no native jobs ran.

## Supported route recommendation

Keep the existing embedded Schnorr account route with cryptographically random nonzero Field keys and an explicit unencrypted JSON backup/import workflow. Remove signature-derived account generation. A deterministic Ethereum signature is not secret key material: anyone obtaining the same signature learns its public `r` component; a signer that varies signatures also breaks deterministic restoration. No external wallet integration or new actor is necessary for this repair.

## Concrete findings

1. `shared/wallet-buttons.js` `_generateAztecFromEth` derives the entire Aztec secret from the first 32 signature bytes. Remove this generator and its UI entrypoint.
2. `_loadAztecWallet` and legacy `shared/aztec-lib.js` loaders use `parseInt` for Field salts, losing precision beyond 53 bits. The wallet loader also writes secret DOM state before validation and can preserve a prior nonzero DOM salt while recording the new file salt in walletState. Parse canonical Fields losslessly; validate and derive before one atomic state replacement.
3. Load/generate swallows address derivation errors and still activates the wallet. Fail closed and preserve the previous wallet instead. Backups should identify the account unambiguously and clearly warn that an unencrypted file grants account control; downloading a file is not proof the user has safely backed it up.
4. Generic wallet errors are reflected to UI and `console.error`, including JSON parsing/import failures. Such errors can contain input snippets or signing diagnostics. Use bounded operation errors without raw exceptions. No direct current board claim-secret value log was found in the examined success paths; generic error paths still need adversarial tests.
5. User engine `_setupKey` omits wallet salt and verified network/artifact identity while retaining the secret string as a cache key. Same secret with another salt can reuse the wrong wallet instance. Other lane owns cache repair.
6. Existing IndexedDB identity already includes full account, chain, rollup, schema and namespace. This is correctly stronger than the truncated dataDirectory prefix. No cross-tab exclusion or provider account/chain change listeners were found in the inspected startup sources. Add action invalidation/scope locking without erasing existing stores.
7. Browser Ethereum connection forcibly switches to chain 1. This conflicts with explicit local/test deployment settings. Validate the configured chain rather than forcing mainnet; invalidate old signer/setup state after provider changes.
8. CLI uses fake-indexeddb process memory. Do not describe it as durable private cache storage. Recovery must use saved wallet/claim data and authenticated resynchronization unless a persistent CLI store is separately implemented and verified.

## Existing boundaries worth preserving

The private FeeJuice funding page saves public recovery metadata, derives secrets from the wallet, and replaces funding errors with bounded messages. The current PXE store refuses unrecognized metadata rather than resetting it. The board requires saved claim recovery data before a deposit is sent. Keep these boundaries and test actual import/restore identity; do not add refunds that leave live L2 rights.

## Limits

Browser scripts necessarily handle embedded keys; same-origin malicious scripts or a compromised device can access them. Unencrypted exported files require user protection. Lost wallet/claim secrets and an unavailable underlying chain do not permit a unilateral safe refund. This source review is not an external cryptographic audit or proof of complete log coverage.

## Wallet UI and daemon integration verification

Root replaced signature derivation with the random embedded wallet route and encrypted browser recovery exports. The initial recommendation above describes the audit starting point, not the final backup format. `scripts/test-w02-wallet-ui.mjs` executes actual wallet button logic with DOM/SDK/backup doubles: full 200-bit salt, atomic import without replacing an existing account, derivation failure, bounded parsing errors, removed signature entrypoint, provider changes during initial connection, and callback failure invalidation. Cryptographic encryption/decryption is independently tested by the backup lane.

The daemon now requires and fixes an explicit Ethereum RPC endpoint as well as the Aztec node and fee configuration, and forwards it to the CLI. Model requests cannot override it; credentials/fragments/non-HTTP URLs fail at signer startup. Censor authority tests use actual disposable mode-0600 key files and confirm censor operations do not read ordinary user/ETH files. The historical shell test is updated to the required endpoint without changing its known-bad control.

Combined signer/authority/wallet UI/shell checks pass 100/100 in `wallet-ui-signer-tests-002.log`. The first daemon endpoint integration suite passed 21/21; the final suite adds an explicit missing-Ethereum-endpoint startup negative. Root owns final integrated runtime qualification.
