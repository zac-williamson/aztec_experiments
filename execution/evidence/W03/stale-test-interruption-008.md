# Native recovery test interrupted by its resource sampler

The first --proof-recovery attempt stopped at155642ms during claim-message
availability, before the new stale-proof experiment. Report:
../W01/application-e8406054-924b-4a6d-b815-37a0dc5a27f8.json.
The stop reason is rss-sampling-failed (Error, no error code), not a proof or
application failure. Peak observed process-tree RSS666304KiB, below the8GiB limit.
The owned process group, descendants and temporary directory were removed.

The previous diagnostic did not record whether the ps command was killed or its
signal, so the exact sampler failure cannot be established from that record.
Added only these nonsensitive fields to future failure evidence. Twenty immediate
samples of the actual supervisor passed (max590ms; stale-sampler-008.log). The ps
2-second timeout, memory cap, hard540-second parent limit and fail-closed behavior
remain unchanged. Rerun the same application qualification, preserving this failed
attempt. No production or cryptographic claim is based on it.

Second attempt: ../W01/application-1607fe1d-67bd-4316-bf32-1752b5b85e07.json.
The improved diagnostic identifies an AssertionError in process snapshot parsing.
The supervisor froze the group before a failed follow-up read, leaving it stopped;
the user subsequently restarted ChatGPT. Root verified the exact owned group and
killed it, after which the parent completed its evidence and cleanup. No failure
of the new stale-proof experiment was observed because it had not begun.

The supervisor now validates a complete snapshot, retries one malformed snapshot
without discarding rows, and always sends SIGKILL to remembered owned processes
after the freeze phase even if another snapshot fails. Fresh absence verification
is still required. Five tests pass, including actual detached child processes and
a synthetic snapshot failure after freeze (stale-supervisor-010.log). Native RSS
cap tightened to2GiB. Subsequent attempt: stale-application-011.log.
