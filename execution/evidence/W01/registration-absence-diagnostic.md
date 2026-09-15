# Registration absence diagnostic

Runs genuine-registration-001/002 returned only a generic worker error. They did not establish a journal/transaction-format defect. Run003 preserved the typed state-reader error SPONSOR_STATE_UNAVAILABLE and showed preparation had not started.

The pinned Aztec v5.2.0 PublicImmutable public read checks is_initialized and asserts with `Trying to read from uninitialized PublicImmutable`. The sponsor get_batch public getter called this directly. Component state-reader fixtures supplied a zero tuple instead, hiding the mismatch. The worker deliberately checks for an existing batch before preparing a registration, so a fresh batch could never reach preparation.

The repair checks is_initialized in the public getter and returns Batch { root:0, window:0, ticket_count:0 } for absence. The existing reader turns this into SPONSOR_BATCH_UNAVAILABLE. No RPC failure is reclassified as absence. Private _consume_coupon still uses the checked immutable read; registration still rejects previously initialized IDs and reserves budget atomically.

The added actual-contract test checks absence, unchanged reservations, subsequent registration using the same ID, exact stored values, and another still-absent ID. Genuine registration/restart verification follows canonical artifact rebuild. Earlier passing author journeys remain historical evidence for their prior sponsor class; final candidate qualification must bind the new class.

Verification: the rebuilt public contract suite passes10 tests, including absent lookup before registration. Artifact comparison against HEAD shows only get_batch and public_dispatch bytecode changed; all private route bytecode and verification keys are identical.

Separate environment observation: run004 stopped advancing during fresh account/genesis preparation, with idle native backends and no deployment or application proof attempted. Root terminated its owned worker after113.988seconds; the supervisor confirmed complete descendant/group/temp cleanup. Component run registration-integrated-003 separately had53/54 controls pass, with its abrupt-death child failing to reach its commit inside15seconds. A native-startup/concurrency cause is suspected, not established. No deadline was extended. Subsequent tests are serialized, including component checks.
