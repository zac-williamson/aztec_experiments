# Harry feedback — 28 October 2026

Scope: wallet connection, Phantom, payment presentation, posting/Bok credit context, Home ranking and account navigation. Images and the moderation-information item were explicitly dropped. No contracts or transaction authorization changed; the performance campaign remains paused.

## Changes

- Signed-out header says Connect wallet; official install links appear when no wallet is detected.
- Phantom Ethereum discovery works alongside other announced wallets, deduplicates transports and uses the selected provider for signatures. Official embedded icon includes its license.
- Signup displays the total and existing USD estimate first, with a collapsed breakdown. Deposit, posting credit and optional Bok credit are explained separately.
- Account navigation directly exposes names, follows/bookmarks, balances/withdrawals, credit controls, settings and sign-out; writing a post is secondary.
- Home uses bounded indexed recent, engaged, discovery and followed candidate pages across all boards. Local ranking combines relevance, freshness, diminishing engagement, read/seen fatigue, exploration, conversation deduplication and public-name diversity. Anonymous authors are never grouped as one identity.
- Reading/topic history exists only in tab memory and resets on account changes. Follow-selection queries retain the owner's accepted privacy tradeoff. Candidate pages share one public snapshot and require no per-post Aztec RPC.
- Actual included posts get visibility priority. All authenticated candidates still feed Bok lifecycle observation; rendered posts remain separately identified. Home restoration cannot exhaust every page searching for a representative that ranking replaced.

## Checks

199 composer checks; 52 reader/model/navigation/adapter checks; eight ranking checks; eight provider checks; four focused persistent-index/SQLite/query-plan/HTTP checks passed. Provider checks include ethers signature recovery with a disposable provider, not a real Phantom extension. No financial-flow changes required new funding transactions.

## MetaMask remains unresolved

The screenshot contains an unexpanded alert for retired contracts, so it cannot identify the current classification reason. No hostname match was found in MetaMask's public phishing list; this does not rule out remote signature classification. DepositFor remains narrowly bound to chain, portal, beneficiary, executor, amount, secret hash, nonce and deadline. No warning was disabled or signing domain disguised. A current expanded alert is required before diagnosing or reporting a false classification.

## Publication and live verification

Application and UI8e68ac4ae34fb214f9816cec0ffc75a4a3e60727 are live. Public asset hashes match the committed sources. All three candidate endpoints return complete pages; /api/status is ready and USDC terms return200. Existing contracts, SDK, signer configuration and prover/Bok services are unchanged.

Actual browser checks verified: signed-out Connect wallet entry; automatic account restoration; visible posting credit550.7869; one Home card for the two-post conversation; full nested conversation still displays both posts; direct names/balances account navigation; and MetaMask/Phantom installation links when no Ethereum provider is present. No new wallet signatures or payments were required. Phantom extension signing and the MetaMask alert were not certified in this run.

Deployment exposed two operator problems. A saved relay record was being mistaken for an active process; native close already drains operations and retains the signer lease/fence across restart. The journal was preserved. Its successful Sepolia transaction subsequently reconciled through the native status endpoint, clearing the fence; no transaction was resent. A new frontend module also lacked a Caddy public route. The previous UI was restored while correcting the exact three routes, then the new UI was enabled with its backend ready. Caddy2.11.7 used its documented SIGUSR1 reload with admin still disabled and the proxy PID unchanged. See [Caddy signal documentation](https://caddyserver.com/docs/command-line#signals).

The publisher now rejects a missing public route before staging; all35 publisher tests pass. Future combined releases must verify backend readiness and public routing before switching the frontend. Do not infer an operation is active solely because a persisted journal entry exists.

Performance goals remain paused. This release does not claim new end-to-end timing results.
