# Remaining W03 qualification checkpoint

Completed milestones are historical evidence, not final W03 closure. Current
implementation is in flight after deployment commit48038a9.

| Stage | Existing evidence | Remaining qualification |
|---|---|---|
| L1 collateral deposit/refund | Real Anvil lost-response recovery, canonical exact-nonce/event checks, portable records | Reconcile in final all-stage suite |
| Private fee approval/deposit | Real pinned token/Inbox/portal lost-response recovery; real native funding | Reconcile in final all-stage suite |
| Aztec claim/post/withdraw journal | Actual SDK serialization, browser/file storage, process death before broadcast, canonical recovery | Real proof restore/replacement and stage-specific stale-state handling |
| Real post stale proof | Linked predecessor records; same nonce/message/chain; 159 integrated checks | Genuine proof replacement passed296744ms; browser and143 artifact checks pass; final all-stage reconciliation remains |
| Dummy screening | Exact proven transaction replay; ambiguous state conflict refuses regeneration | Persist/compare source screening state before supporting fresh anchor proof; do not reuse real-post identity logic |
| Moderator actions | Exact operation metadata, trusted daemon reconciliation, canonical repeated-job success | Final stage checks; durable queue is later M02 |
| Deployment | Engine restart tests, real Ethereum creation/activation recovery, pending settlement UI | Reconcile in final all-stage suite |
| Withdrawal history | Full history, authenticated progress cursor, reorg anchors, beyond500 blocks | Reconcile in final all-stage suite |

Inspect the user-engine missing-note withdrawal branch: absence currently logs
“already withdrawn” without independently identifying the exit transaction. This
must not be presented as proved success. Likewise stale claim/withdraw recovery
must preserve the selected deposit identity, and cannot silently become a new
logical operation. Keep unresolved or ambiguous requests durable.

The native supervisor's sampler failure is a harness issue, not an application
vulnerability or proof rejection. Two interrupted attempts are preserved. Cleanup
now always kills remembered children after freezing them, including read failures;
full snapshot validation/retry and real detached-process cleanup tests pass. The
third attempt passed under2GiB RSS and540s limits with all owned processes/data removed.
