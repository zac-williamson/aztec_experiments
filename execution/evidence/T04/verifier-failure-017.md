# Browser claim succeeded; verifier and supervisor defects

Run017 exercised the actual claim-only retry path and reached the claim rendezvous.
The native coordinator verified the nonempty proof via the normal node verifier,
canonical successful Aztec receipt/effect, and exact canonical ETH deposit event.
It then threw TypeError in journeyExitLeaf: the helper called AztecAddress.fromString,
which is absent from pinned5.2. This is a test-verifier defect, not an application
claim failure. No full lifecycle pass is claimed.

The supervisor awaited browser completion after its native coordinator had already
failed. Root inspected the owned worker report, identified the stranded rendezvous,
and sent SIGINT to the owned outer supervisor. Outer result394713ms, peak1506304KiB,
stopReason interrupted; native report records SIGTERM from owned-tree cleanup.
All process-tree and temporary-directory cleanup checks passed. Sources:
lifecycle-017.json/log and application-5e623d7b-9067-459a-967f-e3fa42736326.json.

Fix the address conversion and test the actual exit-leaf helper against pinned SDK
and independent commitment vectors. Review the remaining verifier APIs before a
new expensive run. Fix supervisor propagation with a real tiny-child regression:
failed native coordinator must stop its waiting browser promptly and preserve the
worker report; successful coordinator may await browser completion normally.

The original helper tests only exercised assertJourneyExit with field-like objects;
they never invoked journeyExitLeaf. That coverage gap allowed this trivial harness
error into an expensive proof run. Retain this failure and add boundary coverage.
