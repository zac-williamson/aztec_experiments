# CLI simulator initialization

Packaged command035 and diagnostic036 failed before transaction submission.
The CLI loaded the browser SDK and initialized Barretenberg, but never initialized
the ABI/ACVM modules. Their default asynchronous initialization constructed browser
relative URLs with an undefined base URL. An independent agent reproduced the
actual bundled WASMSimulator.init failure offline in777ms: TypeError Invalid URL,
zero network requests. This is distinct from private fee contract failure.

Root added one shared local-asset initializer used by both author and deploy CLIs.
It reads regular local files, verifies SDKmanifest hashes, and initializes the
existing modules. No download or alternative loading path. Independent agent
repeated exact consumer call successfully in403ms. Structural reviewer confirmed
package closure and requested exact consumer regression; root added it to the
existing offline test, without adding a production test API.

Final offline consumer plus prover check passed887ms, zero network requests.
42 harness and180 component checks passed. Packaged037 still failed in deposit discovery; simulator repair alone did not resolve that separate defect. See synchronization-diagnosis-043.md.
