# Test hierarchy

Use the pinned Node24, Forge and project-local Anvil versions in BUILDING.md. Run serially, in this order:

1. `npm run test:harness` checks the supervisor with tiny real processes, strict scenario selection, command IO and browser handoff contracts. No blockchain or prover starts.
2. `npm run test:components` checks application boundaries, setup verification and client behavior. `npm run test:application:unit` additionally executes Noir/TXE and Solidity constraints. These do not establish genuine transaction acceptance.
3. Build the release assets, then run the actual offline CLI initialization check: `node scripts/test-cli-prover-offline.mjs`. Package checks must pass before testing packaged commands.
4. `npm run test:e2e -- SCENARIO` runs one explicit scenario. Start with `node`, then `included-board`, then `activated-board` before exercising complete journeys.

Preserve a failed harness check's stage, command outcome and cleanup outcome. Diagnose and fix the underlying cause, then verify the repair; the user has authorized autonomous continuation. Delegate an independent structural review whenever changing the harness. No alternate backend, fee payer, data source or test scenario may stand in for a failed path.

## Development proof configuration

Development and debugging use the existing disposable devnet with proofs disabled.
The development runner defaults to `BOARD_TEST_PROOFS=disabled` and passes the native
configuration flags to both sides: devnet/node `realProofs: false` and PXE
`proverEnabled: false`. To make the selection explicit:

```sh
BOARD_TEST_PROOFS=disabled npm run test:e2e -- included-board
```

These are test-runner configuration values; application and SDK verification code
is unchanged. Reports record the selected mode. Existing acceptance assertions
that require genuine proofs remain in place; proofs-disabled development results
cannot satisfy those assertions or qualify real-proof acceptance. Reserve real
proofs for the testnet acceptance campaign, explicitly selecting its real-proof
configuration. Historical real-proof evidence and all release gates remain intact.

Rolling browser development passes the validated deployment proof mode into the
native PXE option. It uses `proverEnabled: false` only with the disposable local
chain; a metadata label alone cannot override the SDK. Development evidence must
record both native modes and zero proof jobs. Real-proof browser/testnet acceptance
remains separate.

The ordinary CLI preference checks use the captured native configuration: zero
proof jobs when disabled, and the original job counts when real proofs are enabled.
Exact transaction, fee, encrypted-state and recovery checks remain in place. The
relationships development journey has passed with both native flags disabled:

```sh
npm run test:e2e -- rolling-preference-relationships
```

It includes preference writes, encrypted-journal reopen, public-view rebuild and
recovery from keys with an empty local cache. This is CLI development evidence;
it does not qualify browser persistence, full-history capacity or genuine proofs.
Proof-dependent saved-transaction, reorg and browser acceptance remains reserved
for testnet with real proofs.

## Structure

- `scripts/testing/supervisor.mjs` owns application-test child processes, the single 540-second deadline, sampled aggregate 4 GiB limit and cleanup. Browser and native children share this owner; do not wrap these scenarios in another supervisor.
- `fixture-worker.mjs` creates the disposable local chain. `c01-real-node.mjs` owns the verifier node and builds the explicitly requested board fixture.
- `scenarios.mjs` declares the supported scenarios. `scenario-flows.mjs` states each action sequence. Proof and assertion helpers remain ordinary functions.
- `assets.mjs` checks source identity, prover setup and operator package contents. Build or asset failures stop before proving.

There is no implicit scenario, cascading environment flags or legacy aliases. The proof-mode default is the development configuration described above. The old empty invocation and `--bridge`, `--ready`, `--settle`, `--include`, `--posting-diagnostic` routes are removed. Their unique deployment/binding assertions belong to the included/activated fixtures; private-fee journeys replace the public-fee bridge route.

## Scenarios

| Scenario | What it checks |
|---|---|
| `node` | Disposable devnet startup and selected proof configuration |
| `included-board` | Board deployment and ordinary inclusion using the selected proof configuration |
| `activated-board` | Ready binding, actual emitted message and controlled portal activation |
| `censor-commands` | Packaged moderator handover and successor policy change with private fees |
| `private-fees` | Private fee funding, collateral claim, exit and Ethereum refund |
| `private-fee-refund-revert` | Included unauthorized moderator action reverts, private credit loses only the receipt fee, and a subsequent private payment succeeds |
| `repeated-private-posts` | Same-board A1, A2, B1 with distinct collateral and fee funders; exact public-field and private-fee accounting |
| `wallet-absence` | Persistent native wallet reopen after simulated30day absence; exact deposit, screening and private-fee credit |
| `withdrawal-traffic` | Original withdrawal proof survives another author post; that author continues posting afterward |
| `private-fee-post` | Cold private fee claim and private-balance posting |
| `flagged-journey`, `unflagged-journey` | Posting, screening, eligible exit and refund |
| `redeposit` | Second deposit/refund and replay rejection |
| `proof-recovery` | Stale post proof and journal-linked replacement |
| `note-attribution` | Same-note screening/withdrawal attribution |
| `contention` | Ten authors posting from one anchor; explicitly genesis-funded constraint fixture |
| `screening` | Authenticated screening constraints; explicitly genesis-funded constraint fixture |
| `browser-firefox-post`, `browser-webkit-post` | Explicit engine private-fee posting; no automatic browser substitution |
| `browser-metamask-cold-fees` | One board Deposit click from zero credit automatically funds fees and claims collateral, then enables a paid post; MetaMask approves the exact token allowance, fee deposit and collateral deposit in the real extension |
| `browser-metamask-journey` | Real MetaMask approvals and browser application deposit through refund |
| `browser-chrome-performance`, `browser-firefox-performance`, `browser-webkit-performance` | Two independently verified posts in one browser; measure cold and warm proving intervals separately from inclusion. A single run does not qualify percentiles. |
| `browser-post` | Actual GUI posting after native private-fee setup |
| `browser-journey`, `browser-firefox-journey`, `browser-webkit-journey` | Explicit engine GUI deposit, claim, post, screening, withdrawal and refund |
| `browser-post-recovery` | Accepted post, lost response, browser restart and original transaction recovery |

The two genesis-funded constraint scenarios test application authorization and conflicts. They do not qualify private fee anonymity and never select their payer after a private-payment failure.

## Boundaries

Development transactions use the native proofs-disabled devnet and PXE flags. Real proofs remain mandatory for testnet acceptance. Local bridge tests use the installed SDK's explicit Outbox settlement controls. Network epoch proving, Ethereum finality and protocol verifier qualification are outside the application test. No network prover, custom AVM build or Docker is required.

Fixture-only budgets are 60 seconds for node startup, 120 seconds for board inclusion and 180 seconds for activation. Full journeys retain 540 seconds. All expensive runs are serial, below ten minutes, and use disposable identities. Native contention uses two client threads; other profiles use one. Resource limits do not establish production capacity. No automatic retries or threshold increases are allowed. Rerun affected checks after diagnosing and repairing the underlying failure.

Historical results remain bound to their original source snapshots. The new harness must be qualified from the bottom up before it can replace those results. A passing application suite is neither deployment clearance nor independent review. Browser coverage, load, audit, soak and target-network clearance remain separate graph requirements.

## Public feed persistence checks

Component checks cover incremental projection, concurrent writers, atomic range/head
updates, snapshot rollback, forged cache rejection and write volume after10000posts.
The CLI uses built-in Node24SQLite; browsers use IndexedDB. The existing built-feed
browser check reopens multiple nativeIndexedDB ranges and invokes the realCLI.
No wallet/prover is needed for reading. Initial cache replay is linear; subsequent
append/rollback work follows changed ranges, and pages return only needed policies
plus the current policy.

The focused MetaMask check uses actual extension approvals and Ethereum contracts
for fee funding, collateral/refund and encrypted-journal recovery. Its controlled
Outbox roots qualify Ethereum integration, not an L2 exit or the full board GUI.
The cappedEIP1559 receipt regression in the local-mining test prevents reintroducing
the Anvil1.4.1 receipt-accounting defect.

The locked dependency bootstrap also applies the hash-pinned IndexedDB atomicity repair before SDK builds. Run `npm run bootstrap:dependencies` only in an isolated checkout with no active dependency consumers, then rebuild the SDK. `node --test scripts/test-indexeddb-atomicity-patch.mjs scripts/test-sdk-storage.mjs` checks patch integrity and labelled fake-IndexedDB behavior; `node scripts/test-sdk-storage-browser.mjs` verifies the actual built adapter in Chromium with disposable storage. Both immediate and delayed callback failures must roll back all writes, survive reopen, preserve the error, and leave the queue usable. Native LMDB tests do not qualify browser storage.

## Retained MetaMask download browser (macOS ARM64)

Aggregate wallet checks use Chrome for Testing **155.0.8059.79**, including fresh
funding that later reopens a profile. They fail clearly if this pin is absent;
there is no fallback to bundled153. Other browser component checks keep their
existing default. Chromium153 crashes while downloading after a previous download
in a persistent profile ([upstream42506](https://github.com/microsoft/playwright/issues/42506),
[Chromium fix8378127](https://chromium-review.googlesource.com/c/chromium/src/+/8378127)).
The local disposable Blob check reproduced153's second-launch crash and passed
both launches on155. This is a browser compatibility fix, not payment acceptance.

Install the official, versioned mac-arm64 archive without replacing the project
Playwright package. Verify the matching
[official metadata](https://googlechromelabs.github.io/chrome-for-testing/155.0.8059.79.json)
(version155.0.8059.79, platformmac-arm64) first. From the repository root:

```sh
mkdir -p .build/cft-155.0.8059.79-mac-arm64
curl --fail --proto '=https' --max-time 120 \
  https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.79/mac-arm64/chrome-mac-arm64.zip \
  -o .build/cft-155.0.8059.79-mac-arm64/chrome.zip
echo 'e141a7cbf948780bb7d381860bd5a7944c6736f79b9918b9826fccb199d28ea4  .build/cft-155.0.8059.79-mac-arm64/chrome.zip' | shasum -a 256 -c -
ditto -x -k .build/cft-155.0.8059.79-mac-arm64/chrome.zip .build/cft-155.0.8059.79-mac-arm64/unpacked
```

The archive is192,617,424bytes. These SHA256 values are measured from the official
HTTPS payload, not a separately published vendor checksum. The driver also checks
the executable (`c41c446837b5888d9574dbe462a4f01f02459bffee534eb945d2418984135a92`)
and framework (`f20c7ab27196bfdaa20026299acd6d14b6619db3fc4680192fdc7785d1414263`)
with bounded streaming reads before launch. `T04_CHROMIUM_EXECUTABLE` may locate
this same hash-verified build elsewhere; arbitrary versions are rejected.

Use the existing bounded owner and private control file. For an existing unsigned
USDC journal, the export-only diagnostic is:

```sh
T04_AGGREGATE_CONTROL=/absolute/private/usdc-control.json \
T04_AGGREGATE_READINESS_ONLY=true T04_AGGREGATE_EXPORT_ONLY=true \
node scripts/run-bounded-browser-check.mjs scripts/test-wallet-extension-browser.mjs \
  execution/evidence/T04/unique-export-report.json --wallet=metamask --aggregate-devnet=USDC
```

It has the existing60s/4GiB bound, admits no quote/signature/payment/claim, and
authenticates unchanged private records against the downloaded encrypted export.
Keep the report and export destinations absent before launch. Before opening a
retained153 development profile with155, stop its sole browser owner, preserve a
0700 original copy, and run only a separate copy at the same profile path. Keep
the unpacked extension path unchanged because it determines extension identity.
Never erase History, disable browser security, use a personal wallet profile, or
restore an older profile after any financial action. Runtime metadata, identity,
allocation and original fee approvals remain bound by the existing control.

An interrupted **unsigned** USDC review is a separate opt-in continuation, never
the empty-account continuation. After a complete export is verified, select
`T04_AGGREGATE_CONTINUE_UNSIGNED=true` and
`T04_AGGREGATE_UNSIGNED_EXPORT_SHA256=<verified SHA256>` with the original private
control. The driver reads `unsigned-recovery-export-2.json` (0600) from that
control’s retained recovery directory and requires its exact hash, scope, live
claim records, journal records, owner and wallet custody to match. Any existing
intent, submitted relay request, transaction hash, claim or nonzero Ethereum/portal
consent nonce rejects the continuation. `prepared-recovery.json` must still be
absent. Do not combine this flag with readiness/export/paid/Bok/network-only modes.

The existing application then obtains an explicitly reviewed fresh quote using
the original allocation and limits. The private claim fee ceiling must equal the
original encrypted ceiling before signatures are admitted. A new complete
`prepared-recovery.json` is downloaded before the two typed consents and sole
relay POST. No store is cleared; preserve the earlier encrypted export. Any
submitted/unknown payment must use reconciliation instead. The existing120s/4GiB
owner and canonical payment/three-claim/Ready assertions remain unchanged.
