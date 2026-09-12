**Aztec Billboard — production-readiness assessment**

Prepared 11 September 2026. Repository: [vbuterin/aztec_experiments](https://github.com/vbuterin/aztec_experiments), commit [1849967d15d96ab96234091f2fa47d8762a6c06a](https://github.com/vbuterin/aztec_experiments/commit/1849967d15d96ab96234091f2fa47d8762a6c06a), dated 19 July 2026. The downloaded repository is in `/Users/zac/Documents/ChatGPT/Anonymous Message Board/aztec_experiments`. Tracked repository files were left unchanged.

**Recommendation: continue engineering; do not launch this version as a production anonymous board.**

There is a substantial working experiment here: L1 ETH escrow, an Aztec private posting-right note, public posts, moderation and cooldown logic, withdrawals, browser proving, CLIs, and an automated moderation daemon. The remaining work is not just hosting the frontend. The shipped artifacts differ from the reviewed source; the default fee flow exposes a reusable account identity; contract correctness and availability issues remain; and operations and release verification are incomplete.

My planning estimate is **8–12 calendar weeks** for a production candidate, assuming two experienced full-time engineers, part-time infrastructure/security support, and an independent Aztec/Noir and Solidity review booked early. A testnet pilot is plausible around weeks 4–6. These are engineering estimates, not a promised mainnet launch date. The separate V5 network security condition must be resolved before a production launch recommendation.

**The target network needs an explicit release gate.**

Aztec’s [7 August V5 security notice](https://aztec.network/blog/alpha-v5-proving-system-vulnerability) describes a critical proving-system issue affecting application state and asks teams to pause new V5 deployments pending further guidance. It points to V6 work later in 2026. I found no subsequent official clearance in the sources checked. This is an external launch dependency, not a reason to stop development or testing. Fixing this app cannot repair an unsound underlying proving system.

A read-only `aztec_getNodeInfo` call to the documented [mainnet RPC](https://aztec-mainnet.drpc.org) returned node version **5.2.0**, Ethereum chain ID **1**, and rollup version **4248422647**. The rollup address was `0x91ff8bbd8ebb07893010d50a48a1609e5ebd8e34`. The [network overview](https://docs.aztec.network/networks) still listed **5.1.0** when checked. The repository pins Aztec.nr **5.0.0** and uses a bundled SDK. This discrepancy makes a live configuration check essential; it does not by itself prove every 5.0.0 artifact is incompatible. Preserve separate identifiers for the npm/node release and onchain rollup version. The exact RPC response is saved in [mainnet-node-info.json](</Users/zac/Documents/ChatGPT/Anonymous Message Board/review/evidence/mainnet-node-info.json>).

**What I verified**

| Check | Result and limit |
|---|---|
| Download and source baseline | Full repository cloned; current commit recorded. |
| Linked report’s source | Its Certora fork’s Solidity portal and Noir contract are byte-for-byte identical to this checkout’s source. The findings are relevant to current source. |
| Frontend build | All four HTML apps build. This packages existing artifacts; it does not prove they match source or work against mainnet. |
| Solidity build | Current portal compiles with Solidity 0.8.27 and `@aztec/l1-artifacts@5.0.0`. |
| Noir build | Contract compiles with the exact beta.22 compiler identified by the official 5.0.0 manifest. |
| Existing pure Noir tests | 12/12 passed: cooldown arithmetic and message-hash tests. |
| Existing moderation tests | 23/23 unit and 14/14 mock integration tests passed. |
| Additional local EVM tests | 3/3 passed, confirming the stale bundled portal’s minimum/accounting behavior and the current source’s corrected behavior. Bridge calls were mocked. |
| Additional source probes | Confirmed stale censor ABI, unsafe shell construction, and acceptance of a reverted receipt. A note-query model demonstrated the 16-note retrieval boundary. |
| Full protocol validation | Not performed: the remaining 47 stateful Noir tests, proof-enabled bridge round trip, browser/device matrix, concurrency/load tests, Certora rerun, and Lean rebuild remain release gates. |

The installed Aztec CLI was initially a 5.2 nightly and could not serve as evidence for the pinned 5.0.0 test suite. I fetched the matching Noir compiler and ran isolated build/pure-test checks instead. Initial sandbox/network failures were environment restrictions, not discovered application failures. No transactions were sent to mainnet or testnet, no user wallet was used, and no article or upstream repository was changed.

**Priority findings**

“P0” below means resolve before exposing this release to users; it is a work priority, not a claim that every item is an independently exploitable critical vulnerability. “Confirmed” distinguishes source/build/local-test evidence from findings that still need an adversarial network test.

| ID | Priority | Finding | Evidence strength |
|---|---|---|---|
| B01 | P0 | Default fee payment undermines the advertised anonymity | Confirmed default code path and protocol behavior; no live deanonymization experiment |
| B02 | P0 | Deployment bundles an older L1 portal with different behavior | Confirmed metadata, git history, and local EVM execution |
| B03 | P0 | `claim_deposit` accepts an arbitrary L1 sender/portal | Confirmed source; existing report agrees; no full-chain reproduction |
| B04 | P0 | Moderation output enters a shell command unsafely | Confirmed command construction; post-to-model exploit reliability not measured |
| B05 | P0 | Screening does not establish the required note origin/chain relationship | Confirmed missing constraints and framework semantics; adversarial Noir proof required |
| B06 | P1 | Global post counter makes concurrent posts conflict | Confirmed source; production throughput not measured |
| B07 | P1 | Screening searches only a fixed 16-note page | Confirmed query limit; exact failure point depends on note ordering |
| B08 | P1 | Withdrawal can discard an outstanding flag cooldown | Confirmed mismatch between code and stated property; full bridge scenario untested |
| B09 | P1 | Reverted transactions can be treated as successful | Confirmed by exercising actual wallet wrapper with a mocked reverted receipt |
| B10 | P1 | Dedicated censor app uses an obsolete contract artifact | Confirmed ABI/function comparison |
| B11 | P1 | Deployment verification and fallback can miswire the portal | Confirmed source paths; fallback not exercised on a chain |
| B12 | P1 | Moderation retries, policy refresh, and work tracking are incomplete | Confirmed source |

**B01 — the normal fee flow exposes a reusable identity.**

The user engine sends ordinary account transactions without an external fee-payment payload. The bundled `BaseWallet.completeFeeOptions` selects `PREEXISTING_FEE_JUICE` when no fee payer is supplied. In the pinned Aztec account implementation, that makes the account itself the fee payer. Fee payer is a public transaction field. Moreover, the supplied fee-juice app bridges through `depositToAztecPublic(to, amount, secretHash)`, exposing the funded Aztec address on L1. This provides a linkage route between posts using the same account and, for this funding flow, the funding Ethereum address. Omitting `msg_sender` from `_post_public` is not sufficient. See the [user wallet implementation](https://github.com/vbuterin/aztec_experiments/blob/1849967d15d96ab96234091f2fa47d8762a6c06a/apps/src/billboard/user/engine.js#L293), [public funding call](https://github.com/vbuterin/aztec_experiments/blob/1849967d15d96ab96234091f2fa47d8762a6c06a/apps/src/fee-juice/engine.js#L744), and Aztec’s [fee-payer privacy explanation](https://docs.aztec.network/developers/docs/aztec-js/how_to_use_private_fee_juice).

Required: use a supported shared sponsor or private fee-payment contract, fund and limit it, and test the complete observable transaction footprint. Validate what the RPC, fee operator, frontend host, and a chain observer can correlate. Do not introduce a central relay that learns author identities merely to conceal the public fee payer. Revise the product’s anonymity description to match the measured threat model. Public post contents, timing, and small anonymity sets still matter after the fee fix.

**B02 — the deployment app does not deploy current Solidity source.**

Both copies of `portal_bytecode.txt` match the committed older compiler artifact. Its Solidity source hash matches commit `9681e5a2ba`, not HEAD. The old constructor takes three arguments; the deployment engine now encodes four. Local EVM tests show that supplying a custom minimum does not change the bundled portal’s hardcoded **0.001 ETH** minimum. A deposit followed by withdrawal also leaves `totalDeposited` at the old deposit value, although the actual ETH was returned and the individual deposit cleared. The HEAD source fixes both behaviors.

This turns a theoretical deployment-minimum mismatch into a shipped configuration bug. Setting the L2 minimum above 0.001 ETH leaves an interval of deposits accepted on L1 but rejected on L2; setting it below 0.001 ETH makes the advertised lower deposits fail on L1. The stale aggregate accounting also misleads monitoring. This is not evidence that the stale aggregate counter alone permits stealing another user’s escrow.

Required: compile one canonical artifact set, regenerate every consumer, prove the deployed runtime matches reviewed source, and fail CI on artifact divergence. Do not just copy the old generated output. See [artifact provenance](</Users/zac/Documents/ChatGPT/Anonymous Message Board/review/evidence/artifact-provenance.json>), [source difference](</Users/zac/Documents/ChatGPT/Anonymous Message Board/review/evidence/portal-source-versus-bundled.diff>), and [EVM test results](</Users/zac/Documents/ChatGPT/Anonymous Message Board/review/evidence/portal-artifact-tests.log>).

**B03 — collateral authentication is incomplete.**

[`claim_deposit`](https://github.com/vbuterin/aztec_experiments/blob/1849967d15d96ab96234091f2fa47d8762a6c06a/billboard/billboard_contract/src/main.nr#L278) feeds a caller-controlled portal directly into L1-message consumption. It never compares it with the configured portal. An attacker able to send a suitable Inbox message from another L1 sender can obtain a posting-right note without the intended ETH collateral. The normal L1 withdrawal still reads `deposits[msg.sender]`, so this is not a demonstrated arbitrary theft of other depositors’ ETH. It breaks the board’s economic admission rule and strengthens spam attacks.

Required: authenticate against the configured nonzero portal, require completed initialization/wiring, and add wrong-sender, wrong-recipient, wrong-version, wrong-amount, wrong-secret, and replay tests. The read must use the appropriate private/historical Aztec storage mechanism; the report’s illustrative direct public-storage read is not a drop-in private-function patch.

**B04 — model text must never become shell syntax.**

[`runCli`](https://github.com/vbuterin/aztec_experiments/blob/1849967d15d96ab96234091f2fa47d8762a6c06a/censor-daemon/daemon.mjs#L298) builds an `execSync` shell command, escaping quotes but leaving shell substitutions active. `processPost` feeds the LLM’s reason into `--censor-response`. Posts are untrusted inputs to that LLM. A maliciously influenced or otherwise unexpected model response containing shell syntax can therefore cause command execution under the daemon account, potentially exposing its censor wallet and other accessible files.

The local probe exercised the actual `runCli` function with `execSync` intercepted; it confirmed the dangerous command string without executing it. It did not demonstrate that a specific post reliably induces the real model to emit the necessary text.

Required: replace shell string execution with `execFile`/`spawn` and an argument array, validate a structured model verdict, and isolate the signing process from model processing. Regression-test substitutions, quotes, backticks, newlines, and oversized responses as inert argument data. Prompt wording alone cannot fix shell injection.

**B05 — note existence is not proof of rightful chain membership.**

The child/grandchild checks in [`post`](https://github.com/vbuterin/aztec_experiments/blob/1849967d15d96ab96234091f2fa47d8762a6c06a/billboard/billboard_contract/src/main.nr#L391) prove that a supplied note exists and check its backward link. They do not explicitly check the supplied note’s contract, owner, or storage slot against this Billboard and the posting account. The pinned `assert_note_existed_by` uses the supplied contract address when proving inclusion; it is deliberately a generic cross-contract existence primitive. See [pinned framework source](https://github.com/AztecProtocol/aztec-nr/blob/v5.0.0/aztec/src/history/note.nr#L18).

In addition, every deposit starts with the same sentinel, and there is no deposit-specific chain identifier. A single Aztec account can receive notes from multiple L1 deposits. These are reasons to test substitution of a separately created chain, including attacker-created notes whose timestamps and indices do not correspond to legitimate Billboard posts. Hashing a supplied note with the poster’s own secret is not, by itself, evidence that the supplied note belongs to the tracked chain.

Required before sign-off: adversarial Noir tests for foreign-contract notes, wrong owner/slot, multiple deposits owned by one account, and old-chain roots; explicit note-origin and per-deposit ancestry constraints; and a proof that screened indices cannot advance past unscreened real posts. Missing checks are confirmed; the full exploit sequence remains unexecuted and must not be represented as a reproduced exploit.

**B06/B07 — posting and exit need to work beyond a single-user demo.**

Every post reads the shared `post_count` at its private proof’s anchor. [`_post_public`](https://github.com/vbuterin/aztec_experiments/blob/1849967d15d96ab96234091f2fa47d8762a6c06a/billboard/billboard_contract/src/main.nr#L543) demands that the live counter still equals that value. Two posts prepared from the same count cannot both succeed. The losing post needs a new proof, not a retry of its old transaction. Constant traffic can repeatedly invalidate other users’ posts and dummy posts used to exit.

Separately, [`get_screen_hints`](https://github.com/vbuterin/aztec_experiments/blob/1849967d15d96ab96234091f2fa47d8762a6c06a/billboard/billboard_contract/src/main.nr#L760) fetches at most 16 active PostNotes with offset zero and no selector for the required link. PostNotes are never nullified. A required child/grandchild outside that returned page cannot be found by the stock client. The chronological-order model fails when the required 17th note is omitted; the exact first failure in PXE was not measured. Old deposit cycles also share this owner-wide history.

Required: use collision-resistant post identities independent of a privately reserved global counter, retaining public ordering separately if desired; rebuild and re-prove on genuine state conflicts; and retrieve hints by the needed link or with complete pagination. Test 1,000+ lifetime posts, multiple deposit cycles, a large unscreened backlog, concurrent authors, and withdrawal during sustained traffic. Do not raise 16 to another fixed number and treat the issue as solved.

**B08/B09 — exit semantics and transaction outcomes are inconsistent.**

A screening post adds the flag penalty to the note’s future `next_allowed_time`. But [`withdraw`](https://github.com/vbuterin/aztec_experiments/blob/1849967d15d96ab96234091f2fa47d8762a6c06a/billboard/billboard_contract/src/main.nr#L566) checks that time only when there were no real posts. Once real posts have been screened, it permits withdrawal without waiting for the newly accrued penalty. A subsequent deposit starts a fresh cooldown. This contradicts the stated P14 claim that withdrawal/redeposit cannot evade the penalty. Bridge delays affect the practical advantage; they do not restore the invariant for all allowed parameters.

Required: decide whether penalties survive exit, then enforce and test that decision, including the actual L1 withdrawal/redeposit cycle. Also bound `min_deposit × base_cooldown`, `k`, and time arithmetic so valid deployment parameters cannot overflow or truncate penalty calculations.

The wallet wrapper accepts any receipt for which `isPending()` is false and returns it as success. The probe supplied an `app_logic_reverted` receipt and the wrapper resolved normally. Consequently the UI and automation can report a post or moderation action as completed when application execution failed. Required: distinguish successful, reverted, dropped, pending, and unknown transactions; require the intended outcome; preserve receipts; and retry the correct operation with refreshed state. See [source probes](</Users/zac/Documents/ChatGPT/Anonymous Message Board/review/evidence/source-probes.json>).

**B10/B11 — build and deployment automation need repair.**

The dedicated censor app’s local artifact has a four-argument `init`, while the current app has eight. It lacks `get_censor_window`, `get_max_save_up`, `get_moderation_policy`, `get_screen_hints`, and `set_moderation_policy`. The build prefers this local stale artifact over the parent artifact, so rebuilding HTML does not fix it.

The artifact-processing script’s default input resolves under `apps/billboard/target` rather than the repository’s `billboard/target`. VK helper scripts refer to machine-specific Nix paths, including an old nightly. The browser SDK is a large checked-in patched bundle without a complete locked source-to-bundle build in this repo. There is no root lockfile or CI workflow tying together compiler, SDK, bytecode, VKs, and app assets.

In the [deployment engine](https://github.com/vbuterin/aztec_experiments/blob/1849967d15d96ab96234091f2fa47d8762a6c06a/apps/src/billboard/deploy/engine.js#L508), a missing CREATE2 proxy triggers a direct deployment, but later logic continues using the predicted CREATE2 address instead of the actual deployed address. Portal wiring is one-time, so this fallback is dangerous. The final L2-read exception also logs a warning without necessarily marking the cross-check failed. Verification must happen before irreversible linking and before opening deposits. Compare runtime bytecode, actual addresses, chain/rollup/version, Inbox/Outbox, both minimums, censor and policy; any unreadable or mismatched value must fail the deployment.

**B12 — the moderation daemon can silently miss its duties.**

Flagging errors are caught inside `processPost`, but its caller still advances `lastProcessed`. A failed flag is not retried within that run. The cursor is not persisted. Polling uses asynchronous `setInterval` without excluding overlapping runs. Policy is loaded at startup but not refreshed when changed onchain; an empty board’s JSON listing omits the policy/window, further encouraging fallback to a local policy. Each poll lists the entire board, and the per-post lookup adds avoidable work as history grows.

Required: durable per-post jobs and transaction IDs, bounded retries with confirmed outcomes, a single active poller or leased workers, policy-version tracking, incremental reads, and alerts for impending missed censor windows. Pin model/software versions and evaluate multilingual content, prompt injection, and false positives on the real model. The passing mock tests establish orchestration behavior, not moderation quality or production capacity. Define an appeal/unflagging policy: the current flag is permanent, even if the bot makes a mistake.

**How to interpret the existing vulnerability report**

The [visual report](https://autoprover-report.qzhum1996.chatgpt.site/) is a reviewed interpretation of [Certora evidence](https://github.com/Certora/aztec_experiments/blob/shelly/certora-specs/certora/ap_report/report.json). The raw 4 August run records **43 GOOD and 8 BAD rules**, over 42 properties. A GOOD result is scoped to its specification and external-call model. An eight-BAD count is not eight confirmed exploitable bugs. I did not rerun the Certora service.

| Report observation | Assessment for this checkout |
|---|---|
| Unauthenticated claim portal | Still present; P0. |
| L1/L2 minimum mismatch | Still requires a deployment invariant; stale bundled bytecode makes custom settings particularly hazardous. |
| Wrong L2 actor | Real misconfiguration risk. Validate more than a nonzero address and keep deposits closed until wiring is verified. |
| Outbox called before state clearing | Defensive hardening. The pinned canonical Outbox behavior does not establish a live reentrancy exploit. Use checks-effects-interactions and test adversarial dependencies. |
| No deposit nonce in withdrawal content | Preserve the single-active-deposit invariant; do not call this a standalone demonstrated replay theft. Deposit identity is worth adding together with the L2 chain fix and any recovery design. |
| Unsolicited ETH accepted | Confirmed: plain transfers are not credited. Revert normal unsolicited transfers. Forced ETH remains a separate accounting consideration. |
| No recovery path | Real product/operations limitation. Lost claim access or an unavailable bridge can strand escrow. Recovery must invalidate or reconcile existing claims; an independent timeout refund can otherwise leave live L2 posting rights or double-claim opportunities. |

The review’s rejection of “mutable cached Inbox” and unrestricted zero-minimum spam explanations should be preserved. Do not reopen them as confirmed vulnerabilities without new evidence.

The repository’s Lean material is useful design work, but its “70 theorems, zero sorry” wording is not production assurance. For example, [bridge conservation and soundness statements](https://github.com/vbuterin/aztec_experiments/blob/1849967d15d96ab96234091f2fa47d8762a6c06a/fv/bridge_model/Bridge.lean#L99) are literally propositions `True`, and several liveness/security statements do the same. The privacy model omits fee-payer identity and constructs alternative states without establishing that valid executions reach them. The checkout also lacks the complete pinned Lean/Verity build environment. Replace these with meaningful state-transition properties and clearly state cryptographic/bridge assumptions.

**Production components that remain to be built or completed**

| Component | Concrete deliverable |
|---|---|
| Network configuration | Environment-specific manifest; live chain/version/address checks; stable package pins; upgrade and redeployment procedure. |
| Reproducible release | Single-source contracts/artifacts; locked SDK build; checksums and provenance for WASM, VKs, CRS and frontend; CI that rejects drift. |
| Fee payment | Shared private/sponsored route that preserves anonymity; budget, abuse controls, balance alerts, replenishment and outage behavior. |
| Wallet experience | Production Aztec-wallet connection or reviewed embedded wallet; recovery/export; safe handling of signature-derived keys; no secret logging. The current deposit flow logs the claim secret. |
| Feed service | Pagination/incremental indexing, reorg handling, bounded RPC usage, public read access without loading a private wallet, and a defined retention model. |
| Transaction recovery | Persistent journal of deposit/claim/post/withdraw stages and transaction identifiers; resume after reload, crash, RPC outage or long absence. Current withdrawal discovery scans only the last 500 blocks unless a transaction hash is supplied. |
| Escrow operations | Verified min/max parameters, exposure limits, explicit pause/exit/migration design, monitoring of liabilities and actual balance. No generic owner sweep of user funds. |
| Moderation operations | Isolated signer; durable queue; retry/receipt tracking; policy refresh; model evaluations; censor succession; incident response and human review. |
| Hosting | Production HTTPS with the required cross-origin isolation and worker behavior; security headers; reviewed DOM/error rendering; reliable asset delivery. The included Python server is a development server. |
| Credentials | Replace the API credential committed in RPC config; browser-delivered credentials must be treated as public. Apply appropriate provider-side restrictions or a deliberately designed gateway. No secret value is reproduced in this report. |
| Validation | Proof-enabled L1↔L2 integration, adversarial contract tests, browser and recovery tests, concurrency/soak tests, meaningful invariants, and independent review of the release commit. |
| Product operations | Explain public permanent content, reversible UI hiding versus irreversible onchain flags, withdrawal steps/costs, and who operates moderation. Set support and incident ownership. |

The core product decisions should be settled in week 1: retain ETH escrow or redesign admission; sponsorship funding; who holds moderation authority; whether penalties survive withdrawal; whether appeals exist; and the precise anonymity promise. The schedule below assumes the existing ETH-escrow and centralized-censor design is retained, with its flaws repaired.

**Schedule and staffing**

Recommended team: one senior Aztec/Noir engineer owning protocol logic and Solidity, one senior application engineer owning wallet/PXE/fees/frontend, and approximately 0.3–0.5 FTE infrastructure/security support. Arrange independent reviewers with actual Aztec private-state and L1 bridge experience. Indicative internal effort is **20–30 person-weeks**, plus independent audit capacity. These estimates include integration/rework; rows overlap and should not be added as sequential durations.

| Window | Work | Dependency | Exit condition |
|---|---|---|---|
| Week 1 | Freeze scope and threat model; choose supported target; reproduce failures; pin toolchain; remove shell execution; rebuild all artifacts; authenticate portal. Book external review. | None for local work | Clean reproducible build; B02–B04 regression tests; agreed privacy and exit requirements. |
| Weeks 2–3 | Repair screening authenticity and chain identity; remove global-counter contention; implement complete hint lookup; repair penalty/exit semantics and arithmetic bounds; harden L1 constructor/deployment/ETH handling. | Week-1 invariants | Adversarial contract tests pass, including multiple deposits and concurrent authors. |
| Weeks 2–4, parallel | Implement shared private/sponsored fees, wallet integration, real receipt handling and resumable transaction journal. Remove secret logs and review key derivation/recovery. | Chosen fee model and artifact format | Observer test shows no reusable user fee-payer tag; wallet restart recovers every in-flight stage. |
| Weeks 3–5, parallel | Build incremental feed and durable moderation jobs; isolate signer; add policy refresh, alerts, deployment manifest, hosting and operational runbooks. | Stable contract interfaces | Failed flags retry correctly; censor window monitored; deployment fails closed; no full-history poll requirement. |
| Weeks 4–6 | Run proof-enabled testnet deposit→claim→post→flag→screen→withdraw→L1-claim tests; repeated deposits, network faults, 1,000+ posts, concurrent users, supported browser/device matrix and fee/latency measurements. | Contract and application paths integrated | Complete user journey succeeds with real proofs; no unexplained reverts or unrecoverable client state. Testnet pilot candidate. |
| Weeks 5–8 | Independent audit and meaningful invariant verification against a frozen commit; fix and retest findings. Continue operations and moderation evaluation in parallel. | Stable code and audit booking | No unresolved high/critical issues; fixes independently reviewed; deployed artifacts match audited source. |
| Weeks 8–10 | Sustained testnet soak, recovery drill, key-rotation drill, fee-sponsor outage drill, deployment rehearsal, runbook handover. | Audited candidate | At least 1–2 weeks of representative operation; recovery and operator response demonstrated. |
| Weeks 10–12 | Integration/audit contingency and final release review. | All earlier gates; network security clearance | Production candidate signed off. Mainnet launch only if the target’s security condition permits it. |

An eight-week finish requires stable scope, quick resolution of the note/counter changes, and prompt audit availability. Twelve weeks is the more useful planning allowance. A substantial recovery redesign, an independent second audit, or retargeting to a materially different protocol release can extend it. With one engineer, expect roughly four to six months rather than simply halving the team budget. These are estimates, to refine after the first week’s reproductions.

If work starts Monday 14 September 2026, the 8–12-week engineering window ends approximately **9 November–7 December 2026**. This is not a V6 release forecast and not an approved V5 launch date.

**Release acceptance criteria**

1. The target network is approved for the intended exposure, and the application’s exact SDK/compiler/prover/rollup combination passes live preflight checks.
2. The deployed bytecode and all client artifacts match the reviewed source; one manifest identifies contracts, network, censor, policy and asset hashes.
3. Wrong-portal claims, substituted screening notes, replay/double claims, invalid parameters and unauthorized moderation fail under adversarial tests.
4. Concurrent posts, long histories and repeated deposits remain usable; withdrawal is demonstrated under normal and censored conditions.
5. The complete fee/funding/transaction path meets the agreed anonymity model. UI claims match those guarantees.
6. Real proof-enabled bridge round trips pass; application reverts cannot produce success messages or completed moderation jobs.
7. Restart/recovery, reorgs, delayed proofs, RPC failures, signer failures and fee exhaustion have tested outcomes and named operators.
8. Independent review is complete for the release commit, and unresolved issues are explicitly dispositioned rather than hidden by theorem/test counts.

The first implementation milestone should be a reproducible, internally consistent testnet release with authenticated deposits, safe moderation execution, correct fee privacy, and trustworthy transaction outcomes. Hosting the existing `apps/dist` directory does not achieve that milestone.

**Evidence retained locally**

The `review/evidence` directory contains the original visual report, extracted text, raw Certora report, compared contract sources, live node response, compiler/test logs, artifact provenance and diagnostic results. The additional checks are in `review/checks.mjs` and `review/portal-probes`. Their purpose is reproducibility of this assessment; they do not replace the missing production integration suite.
