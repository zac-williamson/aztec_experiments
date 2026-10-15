# Draft 3 baseline — 11 October 2026

Starting checkout: master458724c59ce4656f4c311a07d6651d9f8c33ec1b, clean, matching the PDF's historical snapshot. Existing other worktrees and private runtime configurations were preserved. Development integration uses codex/rolling-chat-draft3. Existing GitHub automation only builds/tests with read-only contents; no deployment trigger was identified. Nothing has been pushed or released during this baseline.

## Compatible tools and reproduction

Use Node24.21.0 (`.nvmrc`, `toolchain.json`), Aztec6.0.0-rc.1 npm locks, Noir1.0.0-rc.3 with pinned compiler commit, Forge1.4.1/Solidity0.8.27 and project-local Anvil v1.7.0 identifying1.6.0-v1.7.0. SystemNode25.8.1 is incompatible; no global toolchain was changed. Existing verified local Node is `.build/A02-node/node-v24.21.0-darwin-arm64/bin/node`.

Follow BUILDING.md for publisher checksum verification, both `npm ci --ignore-scripts --no-audit --no-fund` installations, Noir bootstrap and build. Fresh dependency installation from a git archive of94b5107 succeeded: root22.44s, portal0.72s; disposable checkout removed. See clean-install.json/log. This verifies fresh dependencies, not a completely uncached independent deployment; G12 still owns that acceptance.

Baseline commands from repository root with pinned Node on PATH:

```
npm run build
npm run test:harness
npm run test:components
node scripts/test-cli-prover-offline.mjs
BOARD_TEST_PROOFS=disabled npm run test:e2e -- node
BOARD_TEST_PROOFS=disabled npm run test:e2e -- included-board
BOARD_TEST_PROOFS=disabled npm run test:e2e -- activated-board
npx --no-install playwright install chromium
BOARD_TEST_PROOFS=disabled npm run test:e2e -- browser-metamask-journey
```

No commands use the user's wallet. The application harness supplies disposable identities, loopback chains, bounded process/memory limits and cleanup. Historical test reports sometimes hardcode a proof-enabled label; the run-level applicationProofs=false and actual node realProofs=false establish these development runs' mode. Metadata repair is assigned separately. Nonempty development proof bytes and old phrases such as “genuine” do not establish cryptographic acceptance.

## Observed outcomes

| Check | Result | Evidence |
|---|---|---|
| Complete existing build | Pass, no generated source drift | baseline-build.log |
| Harness tier |78passed | baseline-harness.log |
| Component tier |371passed | baseline-components.log |
| Offline CLI proving initialization | Initial failure; repaired V6 BlockSynchronizer constructor fixture, preserving every assertion.1477ms/3loopback/0external requests | baseline-offline-cli.log,offline-diagnostic.log,offline-cli-fixed.log,offline-review.json,offline-integration.json |
| Local node, board inclusion, portal activation | Pass, disabled application proofs and controlled local settlement | baseline-node.log,baseline-included.log,baseline-activated.log and referenced C01 reports |
| Initial MetaMask attempt | Failed before browser; missing matching Chromium1243. Installed pinned Playwright browser | baseline-browser-journey.log,playwright-install.log |
| Second MetaMask attempt | Failed after encrypted account restore and wallet connection, in setup public simulation before GUI deposit/claim/proof | baseline-browser-journey-2.log; ../T04/application-896ed6ca-bfb0-421b-ad3a-6b3856c09e81.json |
| Cleanup | Failed browser run reports ownedTreeAbsent=true, browserClosed=true, ownedServerStopped=true, temporaryDirectoryRemoved=true | same T04 report |

Independent diagnosis confirmed installed simulatePublicCalls API matches the bundle. RPC-32702 denotes server execution exception, not schema mismatch. Existing redacted evidence lacks inner frames; G02 permits one bounded sanitized diagnostic distinguishing the fixture pre-call hook from node execution. No speculative functional repair or blind retries.

The baseline shows reusable admission, fee, journal, recovery and plugin boundaries. It does not require preserving obsolete application structure. The old plugin public human-account mapping cannot satisfy the new anonymous invocation requirement; public authenticated Bok identity is explicitly allowed.

## Live infrastructure and costs

Read INFRASTRUCTURE_ACCESS.md before service work. Actual local AWS provider identity checks succeeded for both project profiles. The us-east-1 instance, volume and elastic-address queries were empty; the historical prover instance is absent. The historical CloudFront prover endpoint returned504. The local plugin health reported ready with0active jobs. Neither historical receipts nor valid AWS identity qualifies a working prover.

No paid resource was launched or extended. One Cost Explorer query was made. execution/infrastructure-ledger.json conservatively reserves108.28 of the cumulative300 ceiling (including83.27historical campaign bound,0.01query,20delayed-billing/cleanup buffer,5retained-storage/network forecast), leaving191.72 before a fully forecast new launch. Account-wide179.79 is not campaign spending: it includes unrelated services. Reconcile actual resource/routing/archive state and a complete rate/deadline forecast with independently verified shutdown controls before recovery/provisioning. Existing moderator costs retain their separate scope.

Current V6 testnet full-node guidance specifies16vCPU/8GB/1TBNVMe/25Mbps. Storage/sync workload and operating costs remain unmeasured. No operated archive or long-term retention is qualified. G07/G12/G13 retain those obligations. The Mac plugin and local credentials remain a dependency; heartbeat requires computer awake and Codex running. See G01/supervision.md for exact resume and tested recovery limits.

## Bounded diagnostic follow-up

At integrated diagnostic revision5f4e6e, report T04/application-7359a4ca-c985-4037-b118-abb2023c3618.json fails after526.5s. Setup completes without the previous RPC error; posting remains busy, with no GUI deposit started. Fixture exits at u01-browser-flow line230; independent read-only diagnosis is active. Owned process tree, browser/server and temporary directory cleanup all pass. This is a recorded baseline failure, not a qualified user journey; no repeat authorized by elapsed time alone. Six diagnostic unit tests plus five avatar codec checks pass.
