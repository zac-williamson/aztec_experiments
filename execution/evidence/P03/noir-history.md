# P03 actual local note-history regression

Root added three tests to the existing Noir test module after its delegated lane
stopped with an unspecified automated content flag. The agent interruption is
recorded separately; no article or source finding was removed.

The tests use existing TestEnvironment setup_with_deposit, actual private post
calls, actual utility get_screen_hints/get_post_notes/get_deposit_info, and the
existing contract's constraints. They do not substitute a static pagination model
or mocked note-inclusion result. Each post is separated by 7,201 seconds of simulated
chain time, beyond both the 3,600 second cooldown and censor window. Synthetic local
identities and test messages are used; no real wallet or external chain is involved.

Observed three cases in noir-regression.log:

1. Sixteen private posts succeed and actual count is 16; lookup returns child 15.
2. Seventeen private posts succeed; get_post_notes returns indices 0–15. Deposit
   metadata records last_screened 15/latest_real 16. get_screen_hints returns neither
   child nor grandchild, despite the required next note 16 existing.
3. After that same 17-post history and another eligible time advance, the 18th
   normal private post rejects with exactly "Child note required for screening".

The expected-failure annotation spans setup too; a separate 17-post control asserts
setup success, page indices and deposit metadata before testing missing hints.
These are explicitly known-bad observations, not repair acceptance. C04 must change
the implementation and replace the missing-child/failure expectations with desired
successful history traversal. The normal first-page control must remain.

No 32/1000-history or redeposit case is counted as run: this unmodified normal path
already stalls at 18. Production PXE ordering, real proofs, source binding and
multiple-deposit histories remain separate downstream requirements. TXE provides
stateful local contract execution; it does not prove complete protocol/privacy
correctness or live mainnet compatibility.

Root rebuilt contracts/VKs to refresh the manifest after test input changes.
All 32 other recorded generated output files remained byte-identical, including
production Solidity/Noir artifacts and verification keys. Only the input manifest
changed. The preserved before/after inventories and output-change-review.json
record that comparison; no production contract function was changed in P03.
