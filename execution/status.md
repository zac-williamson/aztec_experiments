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

Current work: persisting withdrawal-history search progress across restarts, revalidating chain anchors before skipping already searched blocks. Then continue remaining W03 recovery work.

Withdrawal scan progress is now encrypted and durable in browser/CLI.146 integrated and67 artifact checks pass, plus built-browser recovery regression. See evidence/W03/history-milestone-001.md. Next: portable transaction recovery backups.

Active implementation: portable journal records in password-encrypted recovery files, with authenticated ownership and conflict-safe restoration.

Portable journal backups now work across browser and CLI, with collateral secrets and conflict-safe fresh-wallet restore.184 integrated and80 artifact checks pass; actual built-browser three-profile recovery passes. See evidence/W03/portable-milestone-002.md. Continue W03: remaining consumers and linked stale-proof replacement, then complete interruption coverage.

Active work: moderator transaction journal integration and recovery UI, consolidating duplicated moderator wallet setup.

Moderator journal integration passes198 core and192 moderation/daemon/authority checks. The browser recovery file now preserves collateral custody across all screens. See evidence/W03/moderator-milestone-004.md. Next: fee funding/claim and deployment consumers, then stale proofs and complete stage coverage.

Active: private-fee claim transaction recovery, followed by Ethereum fee approval/deposit recovery.

Fee approval/deposit exact-nonce recovery and standalone L2 claim recovery are implemented, not yet committed.62 focused checks pass; real Anvil fee approval and bridge deposit recovered after lost post-mining responses with no duplicate payment. Native --private-fee-post qualification is running with the540-second bound; log evidence/W03/fee-application-005.log. No parallel heavy jobs.

Fee recovery qualification passes207 integrated and84 artifact checks, real local Ethereum response-loss recovery, and a genuine application claim/post run in4m21s. All owned resources removed. See evidence/W03/fee-milestone-006.md. Continue with deployment recovery, linked stale-proof replacement and full-stage checks.

Active: deployment recovery, including a bounded settlement check and truthful pending status; then persisted setup transactions and Ready provenance. Fee milestone committed and pushed as52a8000.

Deployment recovery milestone passes204 integrated and143 artifact/client checks, real Ethereum creation/activation recovery and built-browser pending/lock checks. See evidence/W03/deploy-milestone-007.md. Continuing stale-proof replacement and full-stage qualification.

Active: bounded transaction RPC reads and durable logical post identity for linked stale-proof replacement. Deployment milestone48038a9 pushed; implementation continues.

After the app restart, removed the verified paused proof-test process group7099 and its orphaned parent completed cleanup. Second native attempt failed in process-snapshot parsing, not proving; exact formatting detail was unavailable. Fixed supervisor cleanup so read failure after SIGSTOP still kills owned children, and added one full-snapshot retry for malformed rows. Five actual-process/parser checks pass. Native memory cap tightened to2GiB; nine-minute deadline unchanged. Continue proof-recovery qualification.

Real stale-post replacement passed in296744ms with1851936KiB peak, genuine conflicting private-fee spend and replacement inclusion; all owned processes/data removed.159 integrated,143 artifact and5 supervisor checks pass; built-browser recovery passes with at most two simultaneous profiles. W03 remains active: correct withdrawal absence reporting and finish action-specific recovery.
