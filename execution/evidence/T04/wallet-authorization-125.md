# Real extension account authorization repair

Run125 passes with ordinary pinned MetaMask13.49.0.0 and bundled Chromium153.0.8010.12:19548ms,3266016KiB aggregate peak, all owned processes/profile removed. This is connection qualification, not fee signing or an Aztec proof.

Run123 reproduced a real application defect: the initial matching accountsChanged notification invalidated the pending browser connection. The focused pre-fix regression reproduces it. The repair binds the first authorization event to the requested signer and a final eth_accounts read, retains immediate invalidation on replacement/network/disconnect, and ignores repeated matching notifications. Independent review caught and corrected the A→B→A race.16 focused checks now pass.

Run124 exposed a test error: removing the explicit extension Connect approval was based on an unsupported inference from123. The actual side-panel route and visible approval control established the required action.125 restored that single mandatory approval; no optional route or retry was added. Failure evidence is retained.

Verification: apps rebuilt; artifact validation and harness hierarchy passed. Both application and harness changes independently reviewed. EIP1193 requires accountsChanged when eth_accounts changes: https://eips.ethereum.org/EIPS/eip-1193 .

Scope: fresh disposable local wallet and Ethereum31337 fixture, actual built application, canonical shared fee address, no existing user profile/funds, no PXE or proving-asset requests. The read-only Aztec node metadata is an explicit fixture. Installed Chrome lifecycle102 is separate evidence; do not describe this bundled-Chromium extension result as installed Chrome.

Subsequent signing pilot126 did not reach signing: network-add request resolution preceded delivery of chainChanged0x7a69, which arrived during connection and correctly invalidated it. This is preserved as setup-ordering failure, not a passing signing test.127 requires both the actual setup event and request completion before restoring/connecting, with no optional-event path or sleep. Independent structural review approved that boundary.
