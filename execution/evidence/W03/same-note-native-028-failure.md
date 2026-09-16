# Native attribution attempt028

The process snapshot reader was interrupted (SIGPIPE, killed=true) while waiting
for local fee-message availability. The supervisor stopped its owned process tree
and removed temporary data. Runtime102075ms, peak1402624KiB. No attribution result
was reached. Report: ../W01/application-d34d476d-76e7-4c82-abdf-4c580262bd47.json.

The sampler now retries one interrupted reader with a complete fresh snapshot,
just as it retries an inconsistent row. Each reader retains its2second deadline;
repeated failure still terminates the test. No cached/fabricated sample is accepted.
Actual-process cleanup and interrupted-reader regression pass in
claim-supervisor-030.log. The application deadline540seconds and2GiB limit remain.
