# RPC batching defect and repair

The independent diagnosis reproduced the failure without a blockchain in1.77s:
actual CLI-loaded SDK BlockSynchronizer and IndexedDB stores advanced to block1
with direct calls, but stayed at genesis through the test RPC adapter. The captured
SDK error was HTTP400: Batch request exceeds maximum allowed size of1.
The SDK catches stream errors internally, so sync resolution had concealed failure.

Root removed the adapter's maxBatchSize1 override. The pinned official client and
server both default to bounded batches of100; the10MiB request-body limit remains.
No alternate source, retry, fee path or initialization bypass was introduced.
Temporary nullifier-query interception and post-command metadata lookup were removed.
The independent native board-initialization assertion remains.

An actual-client simultaneous-read regression passes. The existing CLI consumer
check now runs actual bundled synchronization over loopback HTTP with real IndexedDB
stores and asserts anchor advancement, rather than promise resolution. It passed
in1606ms with zero external requests. Restoring the old limit made that regression
fail in608ms. The fixed source was restored before qualification.

The harness tier passed43 checks. Structural review by scheduler_improvements
approved reuse of official defaults and removal of diagnostic interception. Review
also caught early-success reporting and skipped cleanup on cleanup error in the
component test; root corrected this to attempt all owned cleanup and report only
then. Reviewer verified the final correction, with no remaining blocker.

Full packaged command044 subsequently passed in 242894 ms with peak 850912 KiB,
no failures, owned process tree absent and temporary directory removed. Both
moderator handover and successor policy update used actual private-fee proofs and
canonical receipts. Evidence: application-a68dd80a-a807-4f8c-b7a7-3f00c958d82a.json.
Preserved-journal restart qualification is the next separate extension.
