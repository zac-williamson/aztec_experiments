# Two-thread private application profile review

Read-only independent source review; no native prover or heavy test started.
Reviewed c01-native-profile, its test, parent application harness, board/Ready,
author-claim and contention flows, and application node configuration.

The runtime separation is coherent: parent explicitly selects two private proving
threads for contention (including posting-diagnostic), one otherwise. It creates
an owned bb-two-threads wrapper setting HARDWARE_CONCURRENCY=2 only for that binary
invocation. The worker's inherited HARDWARE_CONCURRENCY remains 1; node verification
uses bb-one-thread with verifier/batch concurrency settings of 1 in
c01-real-node.mjs. Thus this is private application parallelism, not
a change to world-state or node verification thread settings.

The board flow initializes the singleton with the selected backend, exact wrapper
path and thread count and asserts all three after initialization. Ready, author
claims and contention reuse the same profile and explicitly compare the existing
singleton options. Invalid profile values are rejected rather than coerced.
The parent overrides the profile in a fresh explicit environment; arbitrary host
profile values cannot silently alter the selected contention budget.

The 540000 ms deadline and 2*1024*1024 KiB sampled descendant RSS bound remain.
Owned process tracking, cleanup and before/after fingerprint checks remain in
place. The new profile module is included in the parent source inventory. Resource
acceptance still depends on the actual run report; two threads do not establish
that a run fits the bound or improve every workload.

The focused test correctly checks node settings in c01-real-node.mjs. An initial
review message misattributed concatenated search output to the following file;
explicit filename-labelled inspection corrected that reviewer error. No harness
change is needed. The substring tests verify wiring only; they do not replace
observed singleton options or measured resource evidence. Root reports all three
focused tests passed before starting the contention run.

No concrete runtime defect identified in this bounded review. Source changes
after this review require affected verification again. This review does not accept
an unfinished contention run or relax source/cleanup/resource requirements.
