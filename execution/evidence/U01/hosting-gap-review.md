# U01 hosting/browser source review — implementation not started

Read-only inspection while T01 application proof checks run. No hosting, browser,
network or performance test was performed. Priorities below are implementation
work, not new release clearance or an exhaustive security audit.

## Priority 1: concrete unsafe error rendering

`apps/src/billboard/censor/app.js`, `checkCensorStatus` catch assigns a raw
`(e.message || e).substring(0, 120)` into `statusDiv.innerHTML`. RPC/SDK error text
must be treated as untrusted. Use textContent or the maintained escape function;
exercise malicious error text in the actual built page and verify no event handler
executes. The successful censor-status branch also uses interpolated HTML; verify
all values' actual parsed types, or render them as text consistently.
Public feed uses textContent for post text and flag reasons, which is a good
existing foundation. User/censor feed HTML already has escaping helpers; review
all remaining error/status/model-output sinks rather than infer safety from one path.

## Priority 1: supported HTTPS distribution is absent

No `deploy/` hosting configuration exists. `apps/serve.py` is a development Python
server bound to 0.0.0.0, without TLS or CSP. It sets COOP same-origin and COEP
credentialless, but its Accept-Ranges header alone does not establish actual range
semantics. Its startup instructions still advertise obsolete deploy/fee CLI flows.

Provide a reproducible static HTTPS configuration with document/worker/WASM MIME
types, consistent isolation/security headers, exact asset paths, deliberate cache
policy and no directory/source listing. Test the actual built output, not synthetic
headers: crossOriginIsolated, worker startup, WASM initialization and storage access.
CSP must account for current inline scripts/event handlers, WebAssembly, worker
loading and selected RPC endpoints; do not claim a strong CSP by adding unsafe-inline
and unsafe-eval indiscriminately. Public reader must remain wallet/prover independent.
Local TLS rehearsal may use disposable certificates; public deployment remains a
separate authorization/release action.

## Priority 1: capability detection must precede expensive wallet startup

`deploy/app.js` reports isolation/single-thread mode; this is not evidence that a
browser can actually run the pinned prover and storage workers. Shared readiness
currently largely waits for the SDK exports. Add explicit secure-context, WebAssembly,
worker, required shared-memory/isolation and storage checks using actual selected
backend requirements. Distinguish unsupported capabilities from temporary storage
or network failures; keep public reading available. Do not silently label unsupported
single-thread fallback usable. Chrome/Firefox/Safari support requires representative
actual workload measurements; report untested environments honestly.

## Priority 2: public browser configuration and network consistency

`apps/build.mjs` injects optional BILLBOARD_RPC_CONFIG including apiKey. Its comment
correctly states browser config is public, and shared/app-env.js scopes auth headers
to exact origin/path with redirects rejected. Nevertheless every injected credential
is downloadable; hosting must not treat it as secret or reuse privileged credentials.
Keep telemetry disabled by default and inspect actual request destinations.

Shared app-env still defaults Aztec to a public V5 endpoint and Ethereum to
https://invictus.ambire.com/ethereum when configuration is absent. The checked-in
example currently names local Aztec only. Require coherent explicit deployment
configuration or clear unavailable setup, rather than a local Aztec/mainnet Ethereum
mixture. Deployment's new reviewed manifest is stronger; author/censor/public reader
connection UX should expose the selected network/board coherently.

## Priority 2: accessibility and performance verification

Exercise keyboard-only core deposit/claim/post/screen/withdraw/recovery and moderation
flows in built pages, including busy/retry/status announcements and labelled inputs.
Inspect where focus goes on errors and long-running proofs. Existing public feed
uses native details/summary, but this does not establish whole-journey accessibility.

Measure cold cache SDK+CRS initialization and genuine proving serially under current
resource bounds. Public feed already avoids the large SDK. Splitting or lazy loading
private functionality is an explicit design/measurement exercise: check emitted
bundle/request footprint, preserve asset integrity and worker URLs, and assess
operation-specific fetch timing against the privacy model. Do not promise speed or
browser support from a smoke test, nor introduce per-operation fetch leakage merely
to reduce initial transfer.

## T01 probe follow-up

The updated screening probe now checks the exact expected mutated leaf hash before
substitution, separately confirms it is absent, and retains finally-based disarming.
This resolves the previously identified unrelated-missing-leaf qualification gap.
Execution success remains the root's separate proof-run result.
