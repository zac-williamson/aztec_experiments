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

Publication and browser verification are recorded after deployment.
