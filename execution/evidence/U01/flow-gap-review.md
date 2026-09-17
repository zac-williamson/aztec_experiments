# U01 source review — remaining browser flow gaps

Read-only review of current source after D01 integration. No browser run,
network request or implementation changes. Findings below are source-supported;
existing tests are distinguished from complete live user-journey qualification.

## 1. Blocking: private fee configuration has no browser onboarding

`shared/app-env.js:buildConfig` passes `window.billboardPrivateFee`, but no
assignment/import UI for that global exists in application/shared sources or
build configuration. `apps/src/billboard/user/engine.js` correctly rejects
claim/post/withdraw/moderation when that route lacks contract address/gas settings.
The fee funding page exists and implements recovery; it too needs this route.
The user page has no link to that funding page. A stock built page cannot complete
the transaction journey without manual script injection.

Minimum correction: authenticated public deployment configuration/import shared
by user/censor/fee pages, explicit route and maximum fee display, link to funding
and return-to-board flow, durable public config reload. Validate network/fee
contract identity before enabling transactions. Preserve user-owned private fees;
introduce no sponsor. Actual browser test should import config, fund/claim using
controlled engine responses, reload and verify the exact route passed. Existing
private fee engine and genuine native proofs do not cover this UI wiring.

## 2. Broken promise: withdrawal eligibility checks only note existence

`user/app.js:doProceedToWithdraw` says “Eligible!” and advances whenever amount>0;
it never checks screened/last-real sequence or next-allowed time. It can instead
poll a missing note for twelve minutes. The contract/engine still prevents an
invalid withdrawal, so this is misleading UX and unnecessary latency, not an
identified contract bypass. Countdown text also equates sequence distance with
number of required dummy posts, although screening advances up to two notes and
must wait for mature predecessors.

Minimum correction: reuse actual deposit eligibility fields, report outstanding
screening/debt, give an explicit screen action and immediate retryable sync state.
Do not infer withdrawal success from absent notes. Add page tests for unscreened,
flagged debt, eligible and missing-note states; preserve W03 recovery guarantees.

## 3. Blocking production hosting qualification is absent

`apps/serve.py` is a development HTTP server. It advertises Accept-Ranges without
an explicit range implementation and only sets COOP/COEP; no checked-in production
HTTPS configuration was found. Public reading has a genuinely separate small
bundle and wallet-free browser coverage, which should remain separate.

Minimum correction: reproducible HTTPS reverse-proxy/static-host config with
correct MIME/cache/range handling, isolation and appropriate security headers.
Test actual built WASM/workers/CRS requests and fresh browser isolation through
that server. Inline handlers/scripts currently need deliberate CSP treatment;
a restrictive policy cannot simply be pasted in without breaking the pages.

## 4. Environment readiness is incomplete

`checkBundle` only tests SDK presence; `makeCallEngine` checks Web Locks later.
No upfront supported-environment check for secure context, isolation/shared
memory and required storage was found. Bundle polling can expire silently.

Minimum correction: explicit capability/readiness UI before proving, honest
unsupported states, and visible load failure/retry. Measure real cold CRS/proof
initialization serially within existing resource bounds. Do not claim ESM/lazy
loading improves privacy or startup without measured request/asset coverage.

## 5. Network and economic guidance is stale

User template hides a fixed V5 RPC endpoint; shared environment falls back to a
public Ethereum RPC. Deposit/cooldown guidance hardcodes 0.001 ETH, 0.025 ETH and
one-hour assumptions, while deployments now use an explicit manifest. Settlement
copy gives fixed 5–10/40 minute estimates. Public-feed links carry only portal,
so a custom-network board loses endpoint context when opened separately.

Minimum correction: display and use one explicit public network/board config,
show verified board deposit limits and current economic parameters, preserve
network context on navigation, and describe observed settlement stage rather
than promising fixed times. Keep browser credentials explicitly public.

## 6. Accessibility/privacy copy needs focused cleanup

User feed toggles use clickable divs; revealing censored content requires an
interactive Sudoku modal, unlike the public feed's accessible details element.
This imposes an unnecessary keyboard/accessibility obstacle. Posting announces
“posted anonymously” without the more limited threat-model context. Raw error
messages in recovery helpers need review against the shared redaction boundary.

Minimum correction: native buttons/details, keyboard/focus/announced statuses,
clear policy/flag explanations and scoped privacy wording. Preserve existing
text escaping and public-feed textContent protections. Inspect all dynamic error
paths rather than assuming every Error is safe.

## Existing evidence to retain, not overclaim

W02 browser coverage exercises encrypted portable restore, wrong-password
rejection, cross-tab exclusion, journal restoration and deployment pending UI.
F01 browser coverage exercises the actual built wallet-free feed and pagination.
W03 engine/journal and real application proofs cover recovery and fee mechanics.
None of these alone is a complete browser deposit→claim→post→screen→withdraw→L1
refund journey. U01 should add actual built-page orchestration checks and preserve
separate real-proof/native evidence with explicit scope. Model quality is a
release gate, not a prerequisite to fixing these browser flows.
