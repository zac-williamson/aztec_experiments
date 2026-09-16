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

W03 active: user Aztec transactions and Ethereum portal deposits/refunds now save encrypted recovery records before submission/signing. Ethereum recovery retains the original sender nonce and checks the exact transaction plus matching portal event; it can recover a refund after the active receipt becomes zero.182 integrated checks and93 artifact/client checks pass. Actual browser reload and real local Ethereum deposit/refund recovery pass, including lost responses and repeated recovery without another payment. See evidence/W03/ethereum-milestone-003.md.

Still open: portable journal backups, linked stale Aztec proof replacement, fee-funding/deployment/moderation integration, persistent Aztec history-scan cursors and complete all-stage interruption qualification. The graph remains active; this is not production completion.
