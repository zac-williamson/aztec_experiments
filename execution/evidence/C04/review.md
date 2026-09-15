# Screening-history review

Internal implementation and review lanes: history_contract (contract), history_tests (Noir regressions), history_pxe (actual persistent PXE query path), root (client and integration). This is not an independent production audit.

The utility now selects by deposit identity and predecessor link before requesting at most two matching notes. A second match is an explicit ambiguity error. It similarly rejects missing/duplicate deposits, missing successors or keys, and stale sequence/head relationships. Posting and withdrawal still authenticate note membership, contract, owner, slot, deposit, sequence and links in their original private code. Artifact comparison confirms only get_screen_hints bytecode changed; private/public bytecode and verification keys are unchanged. PrivateFPC bytecode and keys also remain unchanged.

Client review found primitive hint entries could reach proving. The adapter now rejects malformed tuple/entry shapes, reports recoverable sync/restore errors, and redacts raw utility diagnostics. Both ordinary and dummy posting use it.

The first build exposed an unsupported unannotated contract helper. It was moved into the existing ScreeningScope implementation, rather than creating an external function or weakening the macro. The first 33-post run successfully retrieved history but its exit fixture tried to move time backwards; eligibility now uses the later of the required time and current time plus one. The repeated 1001-call test was replaced before execution because the measured rate would exceed the test budget.

The seeded test creates 1001 linked dummy notes with official helpers in batches of at most 16 and replaces the live deposit in a test-only context. Normal contract calls subsequently authenticate both tail notes, publish, screen and withdraw. This is deliberately not evidence of 1001 executed or proved publications. Separate 17/33-post lifecycles and multiple-deposit tests execute actual application transitions; a real persisted PXE test checks 1100 synthetic records and restart behavior.

Resource boundary: the oracle response is constant-sized and there is no lifetime-note cutoff in the utility. Pinned PXE still loads/scans owner/slot records before applying selectors. Overall storage/query memory and work are therefore not claimed constant; the actual backend measurement and its 16 MiB test map are recorded separately. This residual scaling behavior must remain visible in release performance qualification.
