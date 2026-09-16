# Current status

Production readiness remains the objective. Engineering continues against the pinned Aztec5.2 toolchain; production network compatibility/clearance, independent review and fourteen-day soak are still required. No public deployment or real-fund operation has occurred.

## Completed application milestones

- Coupon service removed. Users fund an ownerless private FeeJuice contract and spend private credit. No fee operator is needed; cold-start funding remains publicly observable and the configured maximum fee is charged without an unused-gas refund.
- Authenticated collateral deposits/refunds, independent post IDs, exact screening-history lookup and checked cooldown/penalty/moderation rules are implemented and verified.
- Escrow accounting, replay and reentrancy checks pass. Current artifacts are tied to source, with CI drift guards and an aggregate inventory.
- Wallet recovery is complete for the supported route: random embedded Aztec keys, encrypted browser backups, exact salts, scoped encrypted CLI checkpoints and account/network/tab guards. Ethereum browser signing uses an external wallet.

## Latest evidence

125 integrated recovery/application checks and71 artifact checks pass. The actual built browser restores a wallet and collateral secret in a fresh profile, rejects a wrong password and blocks concurrent tabs. A genuine transaction signed with restored credentials claimed and posted using private fees in5m1s total. All owned processes/data cleaned; no network epoch proofs. See evidence/W02.json.

## Next work

Continue the graph with trustworthy receipts and resumable transaction journals: unknown/reverted/reorganized outcomes, interruption recovery and withdrawal discovery beyond the old500-block window. Wallet backups do not yet provide a complete transaction journal. Later product, deployment/operations and final candidate gates remain open.

W03 active: encrypted recovery records now protect user Aztec claim/post/withdraw submission in the browser and CLI. Exact transaction bytes are saved before broadcast; after restart, recovery checks the old transaction before a new action.148 integrated checks and93 artifact/client checks pass, including actual browser reload and abrupt process termination. See evidence/W03/journal-milestone-002.md.

Still open: Ethereum stage journals and matching refund events, portable journal backups, stale-proof replacement, deployment/moderation integration, and persistent history scan cursors. This is partial transaction recovery, not production completion.
