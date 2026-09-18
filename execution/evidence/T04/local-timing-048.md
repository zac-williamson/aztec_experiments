# Local bridge timing correction

Browser047 failed before any claim proof: the actual Ethereum deposit was confirmed,
but the Inbox message remained unavailable after the application's 20-second check.
The fixture used 12-second Aztec slots and the normal two-checkpoint Inbox lag.
Empty checkpoints were already enabled. That normal local delay could exceed the
application's readiness window; the removed claim retry had concealed the mismatch.

Pinned SDK source: ethereum/config inboxLag defaults to two; stdlib/timetable applies
its existing fast local budgets when Ethereum slots are below eight seconds. Actual
buildProposerTimetable construction rejects six-second slots with two-second blocks.
Five-second slots with one-second blocks produce one valid block per checkpoint.
No configured propagation/preparation budgets were reduced beyond the SDK's defaults.

The fixture now explicitly shares 1-second Ethereum slots, 5-second Aztec slots,
1-second blocks, four-slot epochs and Inbox lag two between protocol deployment and
node startup. The component check uses the actual SDK timetable and checks nominal
bridge headroom (17 seconds). This is configuration validity, not a live timing guarantee.
The full browser journey must still pass unchanged 540-second/2GiB supervision.
No application deadline, proof verification, message membership check or retry changed.

Actual browser048 passed in448614ms with1084208KiB peak aggregate RSS.
GUI deposit/claim/post/screen/exit/refund all completed; owned process trees absent
and temporary directory removed. Evidence: application-f8db2d4c-9d49-4199-a943-85db9fdb3bd0.json.
This qualifies this browser lifecycle, not all browser/recovery/load acceptance.
