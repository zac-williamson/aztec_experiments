# W02 integrated verification

Source: source-001.json. Pinned macOS arm64 Node24.21.0/Aztec5.2.0 environment.
Root integrated three bounded implementation/test lanes; later final review turns
hit account usage limits, so root performed remaining inspection. This is an
engineering self-review, not external audit signoff.

## What changed

- Removed signature-derived Aztec keys and browser Ethereum key generation/import.
  Browser L1 signing uses an external wallet; Aztec generation rejection-samples
  a random nonzero Field. Account derivation must succeed before activation.
- Full Field salts are validated without Number narrowing across browser, CLI and
  deployment. Loading cannot overwrite an active wallet. Browser provider changes
  invalidate the session, operation guards recheck context before proof/submission
  and L1 signing, and account-only Web Locks serialize tabs including RPC aliases.
  The setup cache uses derived public account and verified network/board identity.
- Browser backup uses WebCrypto PBKDF2-SHA256(600000)/AES-256-GCM, fresh salt/IV,
  fixed authenticated format, strict bounds and no plaintext downloads. Backups
  include key/full salt and scoped random collateral secrets. Restore checks each
  Aztec secret commitment before a single atomic no-overwrite IDB transaction.
  Wrong password/tamper/conflict/concurrent mutation fail closed. The v2 store
  separates even accounts sharing a key with different salts; v1 is untouched.
- User CLI PXE snapshots preserve actual IndexedDB schema/typed values and are
  authenticated/encrypted to full account/network/rollup/version identity. Private
  regular files, atomic writes, read-back, scope locks and concurrent-change checks
  prevent silent overwrite. Both CLIs require explicit RPC endpoints and private
  wallet files. The daemon forwards its fixed Ethereum endpoint; L2-only operations
  do not require an Ethereum signing key. New private directories are gitignored.
- Browser/CLI error boundaries omit raw RPC/prover/input diagnostics. The SDK build
  fixes internal LOG_LEVEL to silent across main/worker bundles, covering separate
  SDK loggers as well as injected PXE/store/prover sinks. Application progress and
  public receipt identifiers remain visible. Dynamic status text is not HTML.
- Recovery runbook and README now describe the actual supported custody route.
  Historical A01 manifest/C06 runbook evidence was relocated byte-identically to
  each package's evidence folder before updating mutable handover files.

## Observed checks

- 125 integrated application/CLI/backup/session/deployment/consumer checks pass in
  integrated-final.log (~1 second). Commands use NODE_BACKEND=js node --test on
  test-w02-{session,wallet-ui,cli-cache,cli-inputs,cli-session,rpc}.mjs,
  test-wallet-backup.mjs, test-c01-user.mjs, test-private-fee-config.mjs,
  test-engine-private-fee.mjs, test-c05-browser-feed.mjs,
  test-c05-moderation-client.mjs, test-screening-history-client.mjs,
  test-frontend-provenance.mjs, test-shell-baseline.mjs,
  censor-daemon/test_wallet_authority.mjs, test-c01-deploy-activation.mjs and
  test-built-private-fees.mjs. Earlier fixture failures are retained; obsolete
  fixture setup was updated to load the real v2 helper/session boundary.
- 71 artifact/SDK/CI/manifest checks pass in artifacts-final.log (1.5 seconds):
  node --test scripts/test-a01-ci.mjs scripts/test-release-artifact-manifest.mjs
  scripts/test-artifacts.mjs scripts/test-sdk-manifest.mjs.
- Signer/authority/wallet UI/shell lane100 checks and final daemon22 checks pass;
  some overlap the integrated suite. Do not add these counts as unique tests.
- Actual pinned SDK store reopens encrypted persisted data, and actual pinned
  Aztec commitment rejects poisoned backups. These are not hand-written crypto
  substitutes; remaining transport/prover doubles are explicit in tests.
- scripts/test-w02-browser.mjs runs the actual built user page in two fresh
  Playwright profiles, creates a random wallet, saves a real SDK claim commitment,
  exports ciphertext, rejects wrong password, restores identical public account
  and claim commitment, and verifies a third page in the first profile cannot
  invoke an engine operation while that account is locked. No external requests,
  real wallets, secret logs or leftover browser profiles. browser-tabs-final.log.
- Existing genuine --private-fee-post harness used signing credentials reconstructed
  from the actual encrypted backup helper in a fresh VM context, then funded,
  claimed and posted with private fees. SDK testing accounts normally have an
  independent signing key; the fixture first establishes the application's actual
  key-derived identity and reconstructs its signing authority only from restored
  key/salt. Report application-c653ad7c-d91b-4b87-b846-3aa86e9dd578.json passes in
  301227ms, peak descendant RSS786368KiB, networkProofs=false. All owned processes
  and temporary data removed. This proves restored signing authority, not a full
  browser-native proof or a new network-epoch qualification.
- Final SDK/apps builds, actual built CLI account/storage smoke and both cold
  browser SDK/CRS consumers pass. New aggregate write/check binds36 outputs and
  1606 inputs. CI includes focused recovery and actual browser checks; no remote
  CI execution is claimed by these local results.

## Boundaries and remaining work

The browser PXE database itself is not encrypted; unlocked page/device compromise
can expose keys/private state. Backup passwords are not recoverable. Export again
after every new collateral deposit; an older wallet-only backup lacks its random
claim secret. Private-fee public recovery records remain separate. CLI users back
up wallet plus claim-secrets-v2, not only the cache. Browser/CLI backup conversion
and automatic v1 test-store migration are not supported. Existing private files
were preserved. A stale CLI lock requires confirming the owning process stopped
before explicit removal; no automatic destructive recovery occurs.

W03 remains responsible for durable transaction journals, unknown/reverted/reorg
outcomes and long-absent withdrawal discovery. W02 does not claim those fixed.
Independent audit, full candidate qualification, fourteen-day soak and production
network clearance remain separate release gates. No public deployment/real funds.
