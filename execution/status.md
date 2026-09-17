# Current status

Production readiness remains the objective. Engineering continues against the pinned Aztec5.2 toolchain; production network compatibility/clearance, independent review and fourteen-day soak are still required. No public deployment or real-fund operation has occurred.

## Completed application milestones

- Coupon service removed. Users fund an ownerless private FeeJuice contract and spend private credit. No fee operator is needed; cold-start funding remains publicly observable and the configured maximum fee is charged without an unused-gas refund.
- Authenticated collateral deposits/refunds, independent post IDs, exact screening-history lookup and checked cooldown/penalty/moderation rules are implemented and verified.
- Escrow accounting, replay and reentrancy checks pass. Current artifacts are tied to source, with CI drift guards and an aggregate inventory.
- Wallet recovery is complete for the supported route: random embedded Aztec keys, encrypted browser backups, exact salts, scoped encrypted CLI checkpoints and account/network/tab guards. Ethereum browser signing uses an external wallet.

## Current checkpoint

D01 deployment verification is finishing. Reviewed manifests bind network, actors, economics, policy and artifact identity. Actual portal runtime mutation tests, built-browser recovery checks, 334 integrated checks and isolated operator-package smoke checks pass. Final evidence and commit are being prepared; continue the next ready graph package afterward.

M03 is blocked: both measured small moderation models fail the unchanged accuracy thresholds. No production model is approved. X03 target-network clearance remains blocked on its dated evidence and must be freshly verified before release. These blockers do not prevent independent internal engineering.

## Historical progress log

The entries below record earlier states; the graph and current checkpoint above are authoritative.

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

Stale-post milestone c3a93b6 pushed. Active: require canonical exit evidence for missing-note withdrawal outcomes; then continue remaining stage-specific recovery.

Withdrawal absence now requires an authenticated matching deposit and exact canonical exit, under a20second deadline.184 integrated checks and built-browser regression pass. AI reviewer findings addressed. Continue safe action-specific stale-proof recovery.

Active: bind screening/withdrawal replacement proofs to the same board note nullifier. Merely rereading the same note before proving has a race; final proof inputs must retain the original application spend. Reviewer implementing bounded extraction helper/tests; root owns journal/engine integration.

Same-note recovery: real SDK call emits three board nullifiers, so select the exact persistent deposit note through scoped PXE state and require its unique inclusion in the final proof.102 focused checks pass. Native034 in flight; prior failed assumption/sampler attempts preserved. Exact claim recovery and one-attempt submission implemented with canonical L1 receipt checks.

Author recovery milestone verified:423 integrated checks, built-browser recovery and genuine same-note screening/withdrawal/refund in300088ms (1620448KiB peak), all cleanup complete. Continue private fee claim recovery, then deployment/moderator stale proofs. W03 remains active.

Author recovery e73c406 pushed. Active W03 lanes: private fee claim engine/tests delegated; root handles stale deployment/binding proofs. Heavy checks remain serial. Moderator recovery follows.

W03 final review: all remaining consumer recovery implemented;468 integrated checks, actual browser recovery, real local Ethereum lost-response recovery and moderation checks pass. Preparing immutable completion evidence. F01 read-only gap review delegated.

W03 complete with immutable final evidence;468 integrated checks and browser/Ethereum/moderation checks passed. Historical genuine proofs are explicitly scoped. Continue F01 public feed; release gates remain incomplete.

F01 active: shared wallet-free public feed with incremental events, durable canonical checkpoints and pagination. Scope includes scripts and daemon read integration; no private wallet or network prover needed for reads.

F01 complete:23KB wallet-free reader and incremental browser/CLI feed;380 final affected checks plus actual browser/CLI and wallet/moderation checks pass. Continuing M02 durable moderation jobs.

M02 active after F01 commit875c02f. Delegated durable job/lease store; root integrates exact historical policy, structured transaction outcome/finalized-event confirmation, deterministic model digest and bounded scheduling. Shared public-feed metadata and script scope included.

M02 resumed after usage interruption: SDK/client build passed. Final queue rollover and integration reviews delegated; root runs affected regressions serially before recording acceptance.

M02 verification:208 integrated checks and actual built public/wallet browsers pass. Review repaired model rollover polling/duplicate signing and lost replacement responses, including after deadline. Finalizing superseded unsigned jobs before final combined run. Single latest wallet journal limits historical reorg automation; attention states remain explicit.

M02 complete:344 moderation and208 integrated checks, actual built public/wallet browsers, artifact inventory pass. Model rollover and lost replacement-response defects fixed. Evidence bound to6d2ccd2d. Continue M03 real-model quality/runtime qualification; production gates remain incomplete.

M03 active after pushed2b3c7fc: prepare evaluation corpus/runner, verify actual platform runtime identity, measure real model quality within resource limits. No GGUF or llama runtime image currently present in repository/Docker inventory.

M03 progress: frozen332case corpus (320scored,60multilingual,60injection), bounded resumable evaluator and explicit platform-image/weight verification.369 combined moderation checks and8 real Docker/unit runtime checks pass, including interrupted-start cleanup. Qwen3-0.6B Q8 weights downloaded and SHA verified; pinned llama image retrieval in progress after credential-helper stall and bounded pull timeout. No accuracy measurement yet.

Resumed after shutdown: real332case Qwen0.6B run completed in125s with verified runtime and complete cleanup. Failed quality:67/160false positives,2/160false negatives,47errors. No orphan runtime found. Reviewing failure source before next candidate; no criteria waived.

Second M03 candidate running: pinned Qwen1.7B Q4 at2GiB, corrected unsupported rule-number prompt and explicit input-boundary test; all other semanticlabels unchanged. Original failed report/corpus retained. Results save per case. D01 read-only design lane preparing deployment manifest/runtime verification and launch controls.

M03 blocked on measured classificationquality (both candidates fail unchanged thresholds); final bounded candidate run continues only to retain complete evidence. D01 active: reviewed deployment manifest, exact runtime/network checks and supported clean operator packaging. Scope includes shared/scripts/userCLI/daemon launch. Heavy jobs remain serial.

M03 final secondrun332cases/400s:29false positives,19false negatives,zero unexpectederrors,p95 1.76s; verified runtime and clean shutdown. Quality gate remains blocked, no productionmodel endorsed. D01 runtimeverifier25tests pass, manifest integration in progress.

D01 verification: real Anvil full portal runtime/9 immutable mutation checks pass; review fixed critical read deadlines, class identity, provider cleanup and pre-transaction report validation. Final built-browser/operator-package checks run serially.

D01 complete: source c082d6c6;334 integrated checks, final130 signer checks, actual browser, real Anvil runtime mutation,9offline/report and12operator tests plus isolated package smoke pass. Continue next graph package. External gates and model quality remain incomplete.
