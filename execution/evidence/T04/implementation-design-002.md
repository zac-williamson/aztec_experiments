# Minimal genuine GUI lifecycle implementation design

Read-only design,2026-09-18; existing browser044 inputs remain untouched. No proof/browser/build run.

## One mode, existing parent

Add one explicit `--browser-journey` application-test mode, mutually exclusive with current `--browser-post`, native journey, contention and screening modes. It retains `test-c01-application.mjs` source fingerprints, process ownership, sample-gap rejection, 540-second overall timer, 2GiB aggregate RSS and cleanup. It uses the same disposable local protocol fixture and HTTPS/UI assets. Do not build a new testnet or reset the timer at stage transitions.

Minimal future source ownership:

- Existing wiring: `scripts/test-c01-application.mjs`, `scripts/c01-real-node.mjs`, `scripts/c01-bridge-flow.mjs` (mode and source fingerprints).
- Two focused new helpers: `scripts/t04-browser-journey.mjs` (real DOM actions, reusing existing browser runner bootstrap); `scripts/t04-browser-journey-verify.mjs` (parent canonical accounting/effect assertions).
- Small shared-runner refactor in `scripts/u01-browser-post.mjs`/`u01-browser-flow.mjs`: extract existing context/HTTPS/wallet import/adapter lifecycle and expose a supplied fixed driver callback. Preserve existing browser-post behavior and resource ownership; do not clone its150+line bootstrap into a second runner.
- Existing settlement and private-fee helpers reused unchanged unless an explicitly reviewed extraction is necessary. Application engine changes belong to their separate owner, not this test patch.

## Required handoff change

In `c01-bridge-flow.mjs`, browser-post currently performs `depositAndClaimC01` before calling `completeU01BrowserPost`. New full-journey mode branches **before** that collateral call. Keep `prepareW01PrivateFees(...standalone:true)` so the author enters with genuine private fee credit and can pay for GUI claim; this explicitly qualifies warm private fees, not fee acquisition through GUI. Its funding must remain user-funded and author public Fee Juice balance zero.

Backup payload initially contains the real author wallet and no collateral claim secret; the GUI must generate/persist its own deposit secret. Existing public config and disposable Ethereum adapter support actual `eth_sendTransaction`; no signer/proof substitution is needed. Initial UI state should be deposit-needed, not postable.

## Actual visible actions and verifier

1. Import public config, restore encrypted author wallet, connect existing disposable Ethereum adapter. Reach deposit page, fill `#depositAmount`, click the actual navigation action. `app.js` currently performs real `deposit` then real `claim` in this action. Observe post page only after included claim. Parent checks actual portal receipt/depositor/amount/nonce and included claim; never manufacture a claimResult merely to satisfy old post verifier.
2. Wait for genuine eligible checkpoint, fill `#msgText`, click `#postBtn`, require canonical success and exact public text. Preserve existing public-transaction capture, privacy observer and fee-payer verification.
3. Wait for the genuine post moderation window/checkpoint to become eligible using the existing local timing controls. Click `#dummyPostBtn`; require the exact screening-success UI and current replacement note screened sequence reaching the real post. Do not set UI variables or call a fake engine.
4. Click `#navNext` to verify eligibility and reach withdrawal page; next visible action proves/includes withdrawal and reaches L1-claim page. Independently compute the expected exit content/leaf from original receipt and verify the actual included L2→L1 message, as in `c01-exit-flow.mjs`.
5. Apply `settleC01Message({txHash,expectedLeaf,kind:'exit',startProver:false,...})` with the actual exit. Then click the real L1-refund action and verify depositor receipt amount, portal liability reduction, consumed Outbox message and depositor balance minus gas. No call to `withdrawC01L1` to perform the user's GUI action; extract/reuse only its independent assertions.
6. Close browser before reopening any native read-only verification wallet to inspect final notes/balances. This is essential to retain the measured memory envelope. Native read-only inspection does not disable transaction proving or node verification.

## Settlement rendezvous: avoid a hidden race

Existing native flow runs the client phase inside `withC01ClientMining` and settles afterward. Existing browser-post flow waits for browser completion entirely inside that phase. A full browser lifecycle requires a **mid-run rendezvous**, because the browser must stay alive to claim after native official settlement.

Use the existing owned temporary directory and atomic file/IPC convention, with two fixed scoped events: `browser-exit-ready` containing only validated public transaction hash, and `exit-settlement-ready` containing success/fixed failure. Native parent independently derives/verifies the exit leaf; do not trust an arbitrary browser-supplied leaf or request arbitrary settlement. On exit-ready, unwind/stop the existing client-mining loop before invoking settlement; after settlement completion release the browser to its L1 claim. Retain the same global timeout and cleanup. Do not run settlement concurrently with ordinary mining or start a second mining controller. All waits use bounded parent stage deadlines and process-death detection.

## Evidence-based time estimate

Historical browser041 whole test was320.682s. Its timestamps:

| Milestone | Elapsed seconds |
|---|---:|
| Fixture/node ready to prove board |14.896|
| Start official ready settlement |96.850|
| Start private fee funding |115.818|
| Native collateral deposit/claim starts |156.467|
| Native claim complete; browser handoff |223.290|
| Browser ready |245.945|
| Browser canonical post verification starts |308.295|
| Cleanup/result |320.682|

Thus native collateral setup cost~66.8s, while genuine GUI post interval was54.84s. A rough projection replaces that native claim with a browser claim and adds browser dummy+withdraw (~three additional55s intervals):320.7−66.8+165≈418.9s, **before** extra L1 deposit/waits, official exit settlement, refund and altered startup. Allowing40–80s for those gives approximately459–499s. This is an estimate, not demonstrated timing: claim/screen/withdraw circuit work and asset reuse may differ. There is plausible but narrow margin under540s. Memory peak041 was1,809,728KiB; post→screen→withdraw persistent browser memory growth is unmeasured. Dispose each completed prover allocation according to existing production lifecycle, not by modifying proof validity.

Allow one full-lifecycle attempt with stage timing. On budget failure retain exact failed stage/RSS and reassess one concrete bottleneck. Do not reflexively repeat or relax caps. Stage-split independent profiles may provide partial genuine coverage, but cannot be labeled an uninterrupted full GUI success.

## Restart increment after baseline passes

First add exactly one interruption at the post submission response boundary: submit the actual transaction, suppress only its RPC response, close/reopen a persistent browser profile in the same owned run, unlock/reconnect through UI, and click production saved-transaction recovery. Require the original canonical transaction/effects and no duplicate send/proof. Do not conflate simulated missed responses with a fabricated accepted transaction.

Then reuse the same mechanism for distinct claim/screen/withdraw journal operations only where W03's existing fixture coverage lacks a genuine built-browser integration. Real-Anvil W03 deposit/refund response-loss tests remain reusable; add a browser-specific L1 case rather than replay every native case. `runU01BrowserPost` currently uses an ordinary new context, so restart needs an explicitly owned persistent profile, deleted only at final cleanup. A warm reload is not equivalent to process crash; label each accurately.

No implementation or qualification is claimed by this design. Existing P01 multi-engine/p95 and long-history acceptance remain separately tracked; this one real journey cannot establish them.
