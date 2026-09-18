# Current status

Production readiness remains the objective. Engineering continues against the pinned Aztec5.2 toolchain; production network compatibility/clearance, independent review and fourteen-day soak are still required. No public deployment or real-fund operation has occurred.

## Completed application milestones

- Coupon service removed. Users fund an ownerless private FeeJuice contract and spend private credit. No fee operator is needed; cold-start funding remains publicly observable and the configured maximum fee is charged without an unused-gas refund.
- Authenticated collateral deposits/refunds, independent post IDs, exact screening-history lookup and checked cooldown/penalty/moderation rules are implemented and verified.
- Escrow accounting, replay and reentrancy checks pass. Current artifacts are tied to source, with CI drift guards and an aggregate inventory.
- Wallet recovery is complete for the supported route: random embedded Aztec keys, encrypted browser backups, exact salts, scoped encrypted CLI checkpoints and account/network/tab guards. Ethereum browser signing uses an external wallet.

## Current checkpoint

D01 deployment verification is complete and pushed as caf8813. Reviewed manifests bind network, actors, economics, policy and artifact identity. Actual portal runtime mutation tests, built-browser recovery checks,334 integrated checks and isolated operator-package smoke checks pass.

T01 contract/adversarial qualification is complete:171 Noir/37 Solidity checks, meaningful bounded model mutations, fresh compiler correspondence, genuine screening and ten-author contention pass. Full ten-author run:7m39s, sampled peak1.42GiB; all owned resources cleaned. All57 compiler diagnostics remain documented independent-review obligations. Committed/pushed as2734625. U01 is active: browser user flows and HTTPS hosting.

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

T01 active: full contract suites, scoped executable invariant models and preservation/reconciliation of26 compiler diagnostics. Prior Lean claims include vacuous/obsolete models and are not assurance.

T01 current:171 Noir checks completed within540s bound;37 Solidity checks pass; finite models and mutation controls pass. Fresh isolated compiler007 passes privateACIR identity and records57 manualconstraint diagnostics across18sites; all remain open qualifications. Genuine screening/membership-mutation run008 now active under540s/2GiB. U01 scheduling no longer depends on modelquality; M03 remains mandatory for release.

Genuine screening008 passed:335408ms,1377808KiB peak, two correctposts plus exactrandomness/nonce membership rejection and cleanup. Ten-author currentcandidate run010 remains in progress; do not mark T01complete before its result.

Ten-author010 stopped early at449580ms after measured20–22s/post made540scompletion impossible; no qualificationpass. Peak1419920KiB,cleanupcomplete. Investigating2nativeCPUthreads within unchanged2GiB/540s bounds, no parallelproofprocesses or networkprover.

U01 in progress: strict public configuration import/export shared across pages; no mixed-network defaults or browser RPC credential injection. Live board class/reverse/network verification precedes author/moderator actions. Configuration changes invalidate proof/signing, including during awaited wallet calls. Withdrawal UI checks actual screening and cooldown debt.165 integrated checks and actual built public-reader/recovery tests pass. HTTPS requires isolated workers, exact script hashes and a narrow embedded-WASM data fetch allowance; actual wallet workers/storage/encrypted export pass. Cold CRS performance qualification is running; no browser transaction-proving or final acceptance claim yet.

U01 resumed:188 integrated checks and final actual HTTPS/OPFS/CRS/config/feed checks passed. Actual browser proof qualification now being integrated with disposable native setup, token/origin-restricted local RPC, visible wallet restore/post and independent canonical effects verification. Browser prover default thread count will be constrained through supported SDK API. All heavy work remains serial and aggregate540s/2GiB bounded; no browserproof completion claim yet.

Browserpost019 stopped beforebrowserlaunch afteractualfunding/claim/replaypassed: verifier debugnotequery omittedrequiredscopes, SDK TypeError. Corrected toexplicit accountscope.224628ms/1487248KiB aggregate; allownedprocess/tempcleanupcomplete. This isfailedtest-helperqualification, notbrowserproofevidence. Integrating reviewedkeyboard/focusfixes before nextserialrun.

Browserpost021 reachedactualGUI: encryptedrestore, realRPCconnection andpostsimulation passed; postfailed1592msafterprovingstarted, beforeproofcompletion. Browserreportedscript-srcCSPviolation; nofailedHTTP/externalrequests. Msgpackr optionalFunction optimization caughtfallbackmayexplainCSPbutnotnecessarilypostfailure.220428ms/1991168KiB aggregate, fullcleanup. Use upstreamno-evalcodec and safeerror-boundarydiagnosticframes next; do notenableunsafe-eval orclaimbrowserproofpassed.

ActualSDK API defect reproduced025: BaseWallet.scopesFrom nowrequires additionalScopesarray; allthree customwallets passedundefined whennormalprivateFeeSender omittedit, throwingimmediately beforePXE.proveTx. Corrected user/deploy/sharedadapters todefault[] andincludesendMessagesAs exactlyasSDKdoes. Diagnostic025 intentionallystoppedafterdirectSDKrepro (113231ms,1348528KiB,fullcleanup) instead ofrepeatingknownfailure. Actualbrowserproofstillpendingfixqualification. Zod jitless supportedruntimepolicy alsoaddedwithnegativecontrol; noCSPrelaxation.

U01 resumed: latest63 focused regressions and CLI compatibility pass. Browser post026 exceeded sampled2GiB while debugger was enabled and cleaned up. Diagnostic instrumentation now defaults off. Implement supported SDK524288-point BN254 prefix after mandatory full-file verification; preserve other setup and unchanged540s/2GiB limits. Genuine browser proof remains unqualified.

U01: uninstrumented browserpost028 exceeded aggregate memory limit at2379664KiB after221875ms; cleanup complete. Actual HTTPS setup028 and UI-only journey029 pass. Next isolate proof input lifetime and retain all local/node proof verification under unchanged limits. No actual browser proof is qualified.

U01 milestone ae39dd0 pushed. Streaming proof candidate passes16 checks; boundedSDK031build910496KiB, cleaned. Genuine browser031 in progress under unchanged bounds. Quarantine prevents reuse of partially failed proof backend; same SDK circuits and normal local/node proof verification remain required.

Browser031 stopped at2121728KiB/221171ms before completion; supplemental sampling attributes about1.3GiB toChromium and0.7GiB tocombinedtest/node. Candidate033 defersunusedSDKartifactobjects and removes whole-file hashbuffers inhosting generator.65focusedchecks andfee/deployUI033 pass; genuine034 inprogress with bounded public BBstage observation, no debugger.

U01 blocked: genuine browser proof exceeded aggregate memory in034/036; final038 hosting/config/keyboard/journey and CLI pass. T02 active: implement flagged screening-to-refund journey in existing bounded real-proof harness. No production readiness claim.

Flagged full journey004 running: source review passed; latest-note withdrawal adapter3focusedchecks pass. Real author post, authorized flag, screening penalty, early-withdraw rejection and exact L1 refund are under qualification, not yet passed. Sources frozen during run.

Flagged004 passed428824ms/1642224KiB: real post, flag, screening debt, rejected early withdrawals, eligible exit, exact L1 refund and private fees; cleanup complete. Redeposit006 running with two real lifecycles and precise consumed-claim/exit plus corrupt-membership rejection. Public-testnet suitability remains pending; see review005.

Redeposit006 passed442386ms/1629568KiB with two real claim/exit/refund cycles, unchanged fresh receipt after old claim/exit rejection, corrupted Outbox membership rejection and full cleanup. Final unflagged profile includes authentic wrong-origin Inbox and absent-chain probes, source review pending.

Unflagged+origin007 passed426752ms/1247936KiB, cleanup complete. All three local T02journeys pass. T02 remains blocked on retained protocol/privacy compiler and independent disposition; public qualification unresolved. U01 active for supported single-worker experiment, no changed proof/CRS/resource policies.

U01 single-worker candidate:16focusedchecks and boundedSDK/appsbuild pass. Hosting040 exposed stale auxiliary-worker asset expectation; corrected exact one-worker assertion, hosting041passes5947ms/1237808KiB. Genuine browserproof041 running with sourcefreeze and unchanged full verification/540s/2GiB bounds.

U01 complete: one-thread actual browser proof041 passed with normal verification/canonical state and cleanup;143focusedchecks,CLI,config/keyboard/journey/fee-deploy042 allpass. Current qualification043 supersedes priorbrowserblockeronlyforthistestedconfiguration. T03/T04 retain genuinefullGUI/privacy/device/performance work.

Audit dependency cycle corrected explicitly per review011; no release gate or diagnostic removed. T02 active for named remaining wrong-input and corrupted genuine Inbox witness probes. U01 remains complete on tested one-thread configuration.

T02final claim-boundary013 running with allsourcesfrozen. Exact wrongnonce/amount/index/secret missing-message rejection and one malformed authentic sibling constrained rejection must precede genuine positivecontrol; review012passes. T03readonlypreparation delegated.
