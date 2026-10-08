# Current implementation: per-plugin Aztec escrow

The accepted design and interfaces are in [ESCROW_SPEC.md](ESCROW_SPEC.md).
Separate escrows and balances per plugin replace the fixed Ethereum per-post fee.
The board only invokes the registered receiver in its existing posting transaction.
Model pricing, model selection, GitHub and provider credentials remain in the service.
There is no shared billing database or service-owned authoritative user balance.

## Release qualification — 2026-09-23

The new V5/Sepolia board, plugin escrow and Ethereum USDC portal are active.
The isolated HTTPS preview is published on the existing site, with a pinned public
descriptor. The local bot and censor use fresh deployment accounts; no additional
remote instance was provisioned. [Public deployment evidence](evidence/public-deployment-2026-09-23.json)
records addresses, transactions and the remaining gates.

Public browser funding has been reconciled against the original successful
MetaMask transaction after its confirmation window interrupted the test. The
failed run is retained; reconciliation made no second deposit. Proof-enabled
claim and composer posting passed through the built application, with no additional
Ethereum payment during posting. Public paid reply and withdrawal qualification passed: exact draft PR #7,
0.001468 USDC billed against Venice invoices, and 0.998532 USDC withdrawn
and redeemed through the UI after actual public finality. The final token balance,
wrong-recipient rejection and replay rejection passed. All four public phases
passed with successful cleanup. The current clean-build and full-suite CI results
are attached to [PR #6](https://github.com/zac-williamson/aztec_experiments/pull/6).

The client preflights portal transactions before saving submission intents, so a
failed gas estimate cannot strand a never-submitted payment or redemption. Public
redemption checks actual finalized source receipts. All 69 plugin unit checks pass.
The native interruption/release scenario passed with real proofs, restart
suppression and UI release of the full reserved amount. Its explicitly interrupted
runner makes no paid calls; public reply qualification supplies live billing evidence.

The conservative full-context input bound remains deliberate: Venice publishes
prices but does not bind its input serialization to an exact local tokenizer.
The balance requirement can exceed the eventual charge; unsupported pricing is
rejected rather than exposing the operator to unbounded spend. This is a provider
limitation, not a claim of exact pre-call token measurement.

## Invocation budget and concurrency — 2026-09-23

The service now reserves the account's available balance once per invocation,
waits for finality, and meters every model call against the remainder. Independent
accounts run concurrently; proof submission and Venice treasury replenishment are
serialized separately. No new database or contract change.

Native-proof browser run `.build/plugin-browser-8Bdsjj` passed the complete funding,
posting, live inference, exact-content draft PR #5, visible reply and redemption
flow. Three paid calls charged 0.001667 USDC; 0.998333 USDC was redeemed. This
qualifies local chains with actual proofs, Venice and GitHub, not public finality.
[Evidence](evidence/escrow-invocation-budget-2026-09-23.json). Independent review
found no remaining escrow-budget blocker. All 57 plugin unit checks pass, including
concurrency caps, shutdown draining, deferred failures and single top-up under
concurrent demand. The top-up serialization is recorded as a post-browser change.

The public deployment uses fresh faucet-funded accounts and the existing HTTPS
site; see [deployment checkpoint](DEPLOYMENT_WORK.md).

## Proof-enabled live write qualification — 2026-09-22

Fresh supervised run `.build/plugin-browser-ULOndD` passed with native application
proofs, real MetaMask and live Venice/GitHub. It rejected an unfunded post without
publication or provider charge, deposited and claimed 1 USDC through the actual
user page, posted through the composer, created [draft PR #4](https://github.com/zac-williamson/aztec_experiments/pull/4),
and verified its exact file bytes and the visible, unflagged canonical reply.
Two actual Venice invoices totalled $0.00144340; rounding each call to micro-USDC
produced an exact 0.001444 USDC escrow charge. Operator earnings matched, no funds
remained reserved, and the user redeemed the remaining 0.998556 USDC through
MetaMask. Wrong-recipient and replayed withdrawals were rejected. Cleanup and
the supervisor's process-tree checks passed.

[Browser evidence](evidence/escrow-proof-wallet-2026-09-22.json) records invoice
IDs, source fingerprints and the verification boundary.
[Screenshot](evidence/escrow-proof-wallet-2026-09-22.png) shows the reply and balance.
After this run, GitHub branch naming was corrected to preserve the full invocation
ID for decimal SDK values; toolbox API tests cover both decimal and hexadecimal
IDs. This small post-run change is explicitly recorded in the evidence.

The separate native-proof operations run `.build/plugin-operations-XviQRC` also
passed: a fresh zero-fee-balance actor claimed actual bridged Fee Juice, deployed
and registered an independent escrow/portal, and redeemed operator earnings while
preserving user funds. Its synthetic 123-micro-USDC charge is an operator contract
test, not evidence of provider billing. [Operator evidence](evidence/escrow-proof-operations-2026-09-22.json).
The subsequent `.build/plugin-operations-EwLhcd` real-contract regression also
passed: wrong-actor replay is rejected without changing saved deployment state.
That regression explicitly disabled proving and made no provider calls.

Affected JavaScript checks passed (260 before the final cache and GitHub identity
regressions; all 49 plugin tests pass after those changes), as did 18 escrow Noir
tests. Builds and artifact checks passed. The L1 source is unchanged from the
40 passing Solidity regressions below. Independent review checked the deployment
journal, proof policy, fresh fee-credit claim and immutable descriptor caching.

Current operational fixes include on-chain request status and cancellation/expiry
controls, explicit stopped states, provider credit checks before reservation,
service health, deployment commands with exact-transaction journals, and operator
earnings redemption. See [deployment instructions](DEPLOYMENT.md).

Venice connectivity was repaired at the host DNS configuration; ordinary TLS
verification and authenticated calls succeed. No TLS bypass was introduced.

These runs use local Ethereum/Aztec and controlled local epoch settlement; they do
not qualify public-network finality. The existing project's V5/Sepolia endpoints
were located and their identity checked, and the later deployment checkpoint above supersedes that initial discovery. The conservative full-
context input reservation remains; reducing the minimum balance requires a
provider-supported tighter cost bound. At that checkpoint no production deployment or push had occurred.

## Earlier proof-disabled local user flow — 2026-09-22

Fresh run `.build/plugin-browser-FV2hno` passed with exit code 0 and successful
cleanup. It used the actual built author page, real MetaMask, actual local Aztec
and Ethereum contracts, live Venice Kimi K2.5 and a live GitHub read of PR #1.

- An unfunded composer post was rejected: no publication, invocation or Venice debit.
- MetaMask approved/deposited 1 USDC and the user page claimed it on Aztec.
- Posting @bok created its authorization in the existing Aztec transaction, with
  no additional Ethereum transaction.
- The operator reserved funds on-chain before inference. The visible, unflagged
  reply contained the PR URL, changed file and summary.
- Two Venice debits totalled $0.00132556. Per-call rounding to USDC micro-units
  produced a 0.001327 USDC escrow charge, matching operator earnings exactly.
- The remaining 0.998673 USDC was withdrawn through the user page and redeemed
  through MetaMask. The user's Ethereum token balance and portal liabilities matched.
- A modified withdrawal recipient and a replayed Outbox proof were rejected.

[Machine-readable evidence](evidence/escrow-wallet-2026-09-22.json) includes source
fingerprints. [The browser screenshot](evidence/escrow-wallet-2026-09-22.png) shows
the canonical reply and updated available balance before withdrawal.

Validation: 241 affected JavaScript/wallet/journal/interface checks, 14 escrow
Noir tests and 40 maintained Solidity regressions passed. Contract, SDK and app
builds passed. Read-only review checked interface boundaries, journal integration,
reservation accounting, provider-cost comparison and withdrawal persistence.
The browser verifies unfunded rejection and absence of effects; the additional
Noir test verifies the exact insufficient-balance rejection. Adding this test left
all browser-tested runtime source and artifact fingerprints unchanged.

This is proof-disabled local qualification, as requested. It does not assert
proof-enabled or public-network finality qualification. The local token mint and
network epoch settlement controls are fixtures; user funding/posting/withdrawal
are actual UI transactions. GitHub reading is exercised here; this run creates no
new PR. Prior native PR-writing evidence is historical and is not relabelled as
coverage of this browser run. No remote instance, push or production deployment.

## Relevant integration fixes

The pinned SDK's Contract.at does not register private artifacts: both financial
client and service ports explicitly register deployed contract instances. Extension
transactions use the author's existing encrypted transaction journal and canonical
receipt path through generic wallet options. They acknowledge the same journal
scope as normal posts and avoid inheriting a prior board-note nullifier requirement.
Claim/withdrawal metadata is saved before submission; confirmed interrupted claims
and Ethereum redemptions are reconciled. Funds remain accessible when invocation
is disabled. Model input reservations deliberately use the published context
ceiling; the specification explains this conservative balance requirement.

Earlier failed runs identified an SDK address constructor mismatch, missing private
artifact registration, and two harness defects (an intermediate log was mistaken
for completion, and a transformed invoice field name was used for raw ledger data).
They remain failed runs; only the fresh complete run above qualifies this version.
Historical implementation notes are archived in
[evidence/implementation-history-2026-09-22.md](evidence/implementation-history-2026-09-22.md).
