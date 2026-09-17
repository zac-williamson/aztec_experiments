# Independent screening evidence review

Reviewed report: `../C02/application-39636ef8-238a-423a-a490-8a07c8ba5ce7.json`.
Report SHA-256: `f708b0fd5909bde60423f08fbdf4a339d8bcde8e306efde8136749685f3b1145`.
All 40 recorded `sourceHashes` matched current filesystem bytes at review time.
This is an independent agent source/result review, not an external audit.

Result accepted within its stated scope: passed in 335408 ms, below the 540000 ms
application deadline. Sampled descendant-tree peak was 1377808 KiB, below 2097152
KiB. Sampling is not an OS-enforced allocation limit. Process group, remembered
descendants and temporary directory cleanup are recorded true; wallet stopped.

`worker.node.bridge.screening` records two genuine successful checkpointed posts
at blocks 10 and 16, with distinct proof hashes and normal node validation. Exact
deposit nullifier, replacement note, post note and public message checks pass.
The first post has sequence 1/screened sequence 0; the valid later post advances
sequence to 2 and screened sequence to 1. This is an actual mature-child screening
control following the hostile probes, not just a standalone mocked rejection.

The wrong-chain mutation is rejected with `C02 wrong chain`, preserves the original
note and sends no transaction. It mutates an included hint; it is explicitly not an
authentic second deposit/foreign-history fixture.

Both membership probes (randomness and settled nonce) record rejection by the
actual Noir `Proving note inclusion failed` assertion, exactly one oracle
substitution, exact changed-leaf match, and unchanged original note. Source review
of `scripts/c02-screening-flow.mjs` confirms the hook is armed only for the specified
anchor, requires the actual queried leaf to be absent, matches the independently
computed changed leaf, and supplies the authentic original sibling path for that
wrong leaf. The production oracle's ordinary missing-note exception has a different
message and is not accepted as the expected outcome. Each probe disarms in `finally`;
the following valid screening uses the normal node response. No completed hostile
proof or hostile transaction submission is claimed.

Limits: one receipt and two real posts; randomness/nonce mutations do not establish
all membership, owner, slot, header/root, oracle or kernel soundness properties.
Grandchild/dummy, authentic foreign histories, flag boundaries and delayed inclusion
require their separately recorded tests. This run does not establish browser
performance, private-fee privacy, large-history capacity, universal compiler-warning
resolution or production network finality. Ready settlement uses the explicitly
controlled local epoch/Outbox fixture; networkProofs is false. It must not be
relabelled as a network epoch proof or an independent cryptographic audit.
