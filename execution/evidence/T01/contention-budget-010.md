# Current ten-author budget observation

Run application-55df2766-9afb-4fbd-bbca-86530c3e1ae0 was stopped deliberately via
its owned supervisor's SIGTERM path after449580ms, before the540000ms deadline.
All ten authentic claims had been proved and included. Four post proofs were
complete and the fifth was in progress; no ten-author success is claimed.

Observed claim proof starts were142642,159618,176539,...295730ms, with allclaims
sent at312689ms. Same-anchor post starts were362705,382357,404130,423844,443414ms.
The observed20–22second post cost plus remaining inclusion work could not fit
within the remaining90seconds. Stop avoided waiting for the inevitable budget
failure. Peak1419920KiB stayed below2GiB. Owned descendants and tempdir removal
both succeeded. The partial progress/report remain under evidence/C03.

Next experiment: supported native prover CPU parallelism of two threads within
one proof process, retaining the same2GiB sampled RSS and540-second deadlines.
Do not parallelize proof processes, reduce author count, use simulated proofs,
introduce network proving or lengthen the deadline. Record actual native options
and preserve single-thread behavior for other qualified profiles.
