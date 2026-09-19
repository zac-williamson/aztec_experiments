# Persisted wallet after simulated absence

Source-bound report: application-c303664b-da84-4811-968f-8850ad2ebe7c.json.
PASS345553ms, peak2155760KiB under user-authorized4GiB; full cleanup passed.

One genuine private collateral claim and two genuine private-fee posts execute
against the normal verifier node. Between posts, the native EmbeddedWallet and
PXE close and reopen the same owned persistent directory. No account creation or
contract registration occurs on reopen. The same account, existing board/FPC
registrations and exact deposit/nullifier from the first post are asserted.
The second post consumes that state, screens its predecessor after the elapsed
moderation window and verifies save-up arithmetic. Private credit and the shared
fee pool reconcile exactly; the author's public fee balance remains zero.

The local chain advances30days. Before advancing, the existing sequencer pauses
and drains; official RollupCheatCodes mark the pending checkpoint proven to avoid
pruning the history under test. The existing miner synchronizes its clock, then
the sequencer resumes. The first post remains canonical after reopening. No
network proof or additional mining/scheduling service is created.

Independent read-only reviewer webkit_failure_review approved the helper and
integration. Harness tier075 passed. Review identified the need for official
checkpoint retention before execution. Shared fee-wallet construction remains
one function with explicit persistent storage; reopen rejects an already-live
or ephemeral wallet. Existing outer scenario owns cleanup.

Limits: native-wallet/PXE persistence, not a browser or full process-crash test.
Fee-allocation bookkeeping remains in the scenario process. Simulated chain time
is not real elapsed soak time or a1,000-post history workload. Second-post elapsed
time is not isolated proving performance. The successful run does not establish
an epoch-catch-up defect; an exploratory process sample after completion found
no running process and supplied no profiling evidence.
