# Current implementation: per-plugin Aztec escrow

The accepted design and interfaces are in [ESCROW_SPEC.md](ESCROW_SPEC.md).
Separate escrows and balances per plugin replace the fixed Ethereum per-post fee.
The board only invokes the registered receiver in its existing posting transaction.
Model pricing, model selection, GitHub and provider credentials remain in the service.
There is no shared billing database or service-owned authoritative user balance.

## Qualified local user flow — 2026-09-22

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
