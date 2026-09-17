# U01 integrated source review — 014

Read-only independent review on 2026-09-17. This records source conditions, not package completion. No browser, build or prover was run for this review. Sources are concurrently edited; hashes below bind this snapshot.

## Concrete findings for correction

1. `apps/src/billboard/feed/app.js`: a failed reconnect sets `connection=null` while retaining the old message DOM and visible More/Refresh buttons. The failure message does not mark that retained content stale. Clear the view/controls or explicitly label retained results and disable disconnected controls.
2. `apps/src/billboard/censor/app.js`, `checkCensorStatus`: the no-moderator branch hides flag/transfer controls but omits `policyCard`. A previously visible policy editor can survive a transfer to zero. Hide it along with the other controls.
3. `apps/src/billboard/user/app.js`, `initCensorPanel`: the failed-status-read catch reports uncertainty but does not hide previously visible `censorControls`. Hide controls when authority cannot be determined. These two findings concern misleading UI; contract authority checks remain necessary and are not bypassed by visible buttons.
4. `shared/browser-readiness.js`: the storage probe verifies IndexedDB, not OPFS. The actual SQLite PXE path needs OPFS, so an environment with working IDB and denied/missing OPFS can pass readiness then fail generically during setup. Add a bounded OPFS write/read/delete probe or explicitly classify it before PXE startup. The hosting rehearsal demonstrates OPFS only on its tested Chromium environment.
5. `apps/src/billboard/censor/template.html` advertises a 1023-byte moderation response. The shared engine enforces at most 200 UTF-8 bytes (`encodeModerationReason`), and the user page correctly advertises 200. Align the standalone moderator page.

## Positive source conditions

- Public configuration accepts a closed schema, bounds integer/field values, rejects credential/query/fragment URL forms, derives immutable snapshots, and invalidates wallet context on same-page and cross-tab changes. Path tokens remain public; schema rejection cannot make a path credential secret.
- The engine wrapper captures configuration/wallet identity, checks before proving and signing, uses a cross-tab account lock, sanitizes operation errors, and rechecks identity after asynchronous work. Browser-wallet account and chain are reread. Recovery acknowledgements are scoped to the selected configuration.
- Author/moderator feeds and policies use textContent/createElement for untrusted text. Async selected-configuration guards prevent old-board responses from replacing a newly selected board. Withdrawal readiness explicitly requires screening plus canonical chain time; absent notes do not establish withdrawal.
- Public reading has no wallet prerequisite. Public connection checks compare imported chain/version/rollup/board/portal, original and current contract class, and on-chain board binding. These are RPC-response checks, not an independently verified network state.
- The new browser connection helper is present and called in app-env for board actions: it compares the bundled portal runtime including immutable substitutions, expected identities, and canonical derived fee address before fee-bearing board operations. This review does not substitute for the helper author's focused tests or the final release rebuild. The fee-funding page intentionally has no board artifact; its own engine independently checks selected network and derived fee address and passes context guards to funding/journal operations.
- Deployment remains manifest-driven instead of inheriting the author's board. Public configuration export is constructed from the deployment result and reviewed network, with optional validated fee settings.
- Hosting restricts serving to named release assets, disallows symlinks, sets isolation/no-referrer/nosniff headers, hashes inline script/handler bodies, allows reviewed RPC origins, and compresses text responses. CSP has no general script unsafe-inline/unsafe-eval; wasm-unsafe-eval supports WASM, connect-src data supports the SDK's embedded WASM fetch, blob workers support SDK workers. Inline styles and hashed inline handlers remain deliberate allowances, not a claim of fully externalized scripts/styles. CSP endpoint allowlisting must accompany configuration distribution.

## Evidence and remaining acceptance limits

`cold-crs-013.json` records a passing local HTTPS rehearsal in 4,347 ms with sampled owned-process peak RSS 1,429,488 KiB, exit 0, absent owned tree and removed temporary directory. It is fresh-browser startup/CRS initialization plus actual workers/storage/encrypted wallet export; it is not a transaction proof or a real deposit-to-withdraw browser journey. Local TLS bypass is scoped to the disposable context, not a production trust setup. Local disk/OS caches can be warm and public-page ACVM is compiled earlier in that same run. No Internet latency or broad device/browser capacity claim follows.

Current `apps/dist/aztec_bundle.js` is **50,400,004 bytes**; actual gzip HTTP transfer in 013 is **28,118,739 bytes**. The lazy assessment's **54,978,603 bytes** is correctly an observation of the distinct `shared/aztec_bundle.js`, which still has that size. These are different artifacts and must not be described as the same release measurement.

Before closing U01: resolve findings above with focused regressions; rebuild/rebind the changed frontend and repeat the actual HTTPS/browser check; qualify complete GUI journeys/recovery and keyboard interaction at the intended acceptance scope; state the tested browser/device support honestly. Cold CRS/worker smoke checks alone do not establish representative browser transaction proving latency/capacity. Lazy-provider/code-splitting analysis is an evaluation, not an implemented payload reduction; an adoption decision must preserve integrity, worker paths, CLI behavior and the privacy implications of request timing/path differences.

## Source snapshot

- `shared/public-app-config.js`: `a1fb9450185b749480d42fb85195e8bb1734fcaf60047b640820867079f40d53`
- `shared/public-app-config-ui.js`: `0e463fda9990e0a2b45303fd1ba1589863a09feee704a9abde32636e9940ce4a`
- `shared/app-env.js`: `0a17a7387f4527b1e918ffe54f2f668b8fa7fe5d5c709833b0fc86f399237de1`
- `shared/browser-readiness.js`: `62fd221b476826d1b6a0573d9e511da2efbb29c17b94bbda5b4b352263401bbf`
- `shared/browser-connection-check.js`: `1bf1165e35a07da1e86cb29626ddec84785f827016244155da60a99231fd991b`
- `shared/public-feed-connection.mjs`: `cc357878cba5bf56d7c4010e301d49bb61d7acbf049029d4aa218ce4983a3710`
- `shared/public-feed-browser.mjs`: `3b5d854206d47a285c2b90d2584f3794da467cb8eb58b75634fedab45d8a5877`
- `apps/src/billboard/feed/app.js`: `d664d7c49661289ef8451495f239e9e01c7d46b3272fb443c263589485377973`
- `apps/src/billboard/user/app.js`: `78e2a3189044c4a34da87cd136e7f52d41676ee5d476645c62bc7f125dd15b6c`
- `apps/src/billboard/censor/app.js`: `84a2ccb67bbef6418ef4ca0285ef88c965ce74680331bf21adfc44fb217896c7`
- `apps/src/billboard/censor/template.html`: `17c26ae9c710febe41c283472d1b448bb11f1e8081fdd0886bcabea82a9ff1d8`
- `apps/src/billboard/deploy/app.js`: `9ba183fa1e5a271981a985f43f774b4b7e5873f078b0f06cfc001d36687d412c`
- `apps/src/fee-juice/app.js`: `9ab0099bb9195d378df34710e48ea3baff012fc8310f478fd5468e2acd80e38a`
- `apps/src/fee-juice/engine.js`: `e0ea2f0ab92814497515d6262dfca043762ba17d177ab8f6a4db62b1922d42b6`
- `deploy/hosting-config.mjs`: `cc7e823b72908c4c26ce154089396c68a741c785a6b8d977fca0e4e6d000c780`
