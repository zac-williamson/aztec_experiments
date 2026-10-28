# Current wallet custody checks

The three existing CI entrypoints now exercise supported account APIs. This is a
fixture update, not a new recovery feature or a migration of old test accounts.
Ethereum sign-in replaced password account files/passkeys in `0726aad9`; shared
legacy controls were removed in `209ed2ee`, and the recovery CLI in `cc12e2c1`.

| Earlier assertion | Current coverage |
| --- | --- |
| File/passkey unlock preserves a full field salt and derives the account | `test-w02-wallet-ui.mjs`: `connect(..., {deriveAccount:true})`, silent `restoreRemembered()`, canonical raw fields and derived-address validation; current real signature/SDK integration below |
| No silent identity replacement; cancellation and wallet changes fail closed | W02 retains all direct provider/account/network/event tests, rejects active replacement, verifies cancelled-signature retries request selection, and rejects context changes before persistence |
| Malformed remembered identity cannot activate | W02 discards obsolete derived-address/field caches under the current disposable-state policy; AEAD authentication errors fail closed without signing or saving a replacement |
| Account UI errors hide sensitive diagnostics | W02 tests current sign-in/sign-out failures, safe warnings, throwing render/setup hooks and busy/cross-tab sign-out guards; removed file/password/passkey controls stay absent |
| Password encryption, wrong-password and envelope tamper checks | `test-wallet-backup.mjs` imports current `ethereum-account-session.test.mjs`: actual WebCrypto AES-GCM, nonextractable key, metadata/ciphertext/key/scope/version rejection and scoped clearing. No password envelope exists in the app |
| Identity restore recreates the same account | The same entrypoint imports `ethereum-account-integration.test.mjs`: actual Ethereum signatures and pinned SDK address derivation, silent reload, sign-out/recreate, changed-owner rejection and explicit test-account generations |
| Claim bulk export/restore isolation and overwrite protection | Current claim `load/save` tests retain full-salt/key isolation, every authenticated scope field, ciphertext rejection, idempotence, conflict rejection and a genuine concurrent IndexedDB insertion. No claim bulk export API exists |
| Portable SDK transaction browser/file roundtrip | `test-w03-journal-backup.mjs` transfers the actual `createJournalBackup()` authenticated ciphertext records via JSON, with no private identity envelope. Actual SDK Tx bytes/hash survive both storage adapters |
| Older/foreign/modified journal records and duplicate writes | W03 keeps all these negative cases, including descriptor damage, moved key, duplicate records and newer-local-state protection |
| Recovery CLI file custody | The CLI was removed. W03 instead reopens the supported file journal adapter, verifies private file mode and rejects a record made group/world-readable |

`shared/wallet-buttons.test.mjs` separately checks real presentation wiring with a
DOM/account double. `scripts/test-c01-user.mjs` and the SDK funding tests retain
actual protocol commitment checks; the claim storage adapter itself does not
claim to prove a chain commitment.

Local verification: Node **24.21.0**, `NODE_BACKEND=js`, all three entrypoints:
**89 passed, zero skipped**. These are local cryptographic/storage and UI-unit
checks. SDK transaction fixtures contain random proofs; no browser or native
chain journey, live service change, or real-proof acceptance is inferred.

## Built browser component

`test-w02-browser.mjs` now uses the same current custody path in actual Chromium:
an in-memory disposable Ethereum signer answers the explicit EIP-1193 signature
request; the built application performs real signature verification, SDK address
derivation and encrypted IndexedDB storage. A reload restores the same account
without another signature. Rejected signing creates no remembered session;
ciphertext tampering is rejected; the stored AES key is nonextractable; sign-out
clears the session and requires a new signature. Private account fields remain
inside the browser, including on failed assertions.

The former password/file/passkey ceremony is replaced, while the existing real
Web Locks exclusion, unchanged L2 transaction hash recovery, unchanged Ethereum
nonce recovery and pending-deployment UI checks remain. Claim load/save survives
reload and stays local to its browser profile. `createJournalBackup()` transfers
only authenticated ciphertext between fresh profiles after each separately signs
in; another Ethereum owner cannot import it. There is no claim bulk-export or
identity-file API in the current application.

Local verification: exact Node24.21.0, five fresh Chromium profiles, **passed in
9.84 seconds**, peak process-tree RSS1,454,304KiB. The existing60second/4GiB
supervisor limits and process-tree cleanup remain; W02 fingerprints now reference
current session/journal sources instead of the deleted password/passkey modules.
All retained manifest tracked inputs and committed app outputs matched before the
run. This is a local browser component check with synthetic chain observations,
not a real-proof testnet journey or permission to promote a release.
