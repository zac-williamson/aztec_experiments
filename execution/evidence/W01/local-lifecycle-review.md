# Disposable local-node lifecycle

Final observation: `network-startup-f32153c6-f7eb-4142-ba4f-6cf84f4b1d1d.json`.
The pinned node starts on a fresh Anvil chain31337, with no peer network, no
Aztec HTTP server and no extension to the default public setup allowlist. Worker
and Anvil close normally; temporary data is removed. There are no remaining
RunningPromise loops. This is a mock-verifier, non-proving infrastructure check,
not a sponsored transaction or production privacy result.

The first attempts exposed explicit local backend/tool path requirements,
then an incorrect expectation that getConfig returned p2pEnabled. The actual
connectivity API reports disabled networking. Subsequent attempts verified
startup but timed out during process exit. Each failure is retained.

Timer tracing identified RunningPromise polling. Explicit global proving
singleton and validator shutdown did not resolve it: the validator loop was
already stopped. Allocation tracing then identified
SequencerPublisher -> RollupContract.listenToSlasherChanged -> watchContractEvent.
The publisher discards the returned unsubscribe function. The harness retains
that actual handle, invokes it after node shutdown and awaits the associated
polling promise. Event delivery during the run is unchanged. No dependency file
is patched, no unknown timer is cleared and no forced successful process exit is
used. Parent termination remains a failure path with a bounded deadline.

The final check removes temporary async timer tracing; RunningPromise ownership
tracing remains to drain retained watchers and assert none survive. A previous
diagnostic's timer object list included a cleared object awaiting its destroy
notification; active-resource observations and normal worker exit are the
lifecycle result. Historical diagnostic output is not rewritten.

This lifecycle adapter is specific to disposable pinned-V5.2 testing. Production
startup/termination qualification remains D01/T05 work. Complete sponsor payment,
funding, failure and privacy criteria remain unverified under W01.
