# Delegated board verification checkpoint

This is a substep of W01, not acceptance of fee sponsorship. Direct board methods and delegated methods share the same private owner-bound implementation. New authwit checks authorize exact full call arguments and reject self-caller/zero-nonce shortcuts.

- Build002 succeeded after verifying four newly embedded SDK files against the existing full locked package inventory. Fresh official-archive origin verification passed for all dependency packages; no protocol/dependency upgrade.
- Initial test compilation failed because the test helper fixed the second PrivateCall generic to zero. Corrected it to accept both actual generic lengths. No application change was needed.
- Build003 succeeded. Targeted run002 passed11/12 tests. The exact authwit nullifier had been observed in the actual board call, and reinsertion failed in the actual nullifier tree. The test expected different error wording. Corrected its expectation to the observed `NullifierLeafValue is not updateable and` substring; this does not broaden acceptance to an arbitrary failure.
- Build004 succeeded. Full affected Noir regression is supervised under the unchanged540-second test deadline. Result is recorded separately when complete.

TXE runs execute application constraints and actual Schnorr authorization but do not generate transaction proofs. The replay control inserts the exact emitted nullifier through the official context helper; it is not misrepresented as an end-to-end replayed transaction. Actual sponsor composition, fee debit, L1 funding/refund leaves and zero-author-balance proofs remain required. The production sponsor patch and policy tests are drafts until compiled and integrated.

Full run completed successfully:149/149 tests passed, approximately281seconds from service startup to final result, within540seconds. Before/after application fingerprint identical:844c933b7204c537eaf6fda55c8c26ffaed5d9049dabdc47bc657f8b910cd357. Build004 and delegated-full-noir-001.log are the final records.
