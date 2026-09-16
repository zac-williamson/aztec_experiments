# Private fee transaction recovery

Fee-token approval and FeeJuice bridge deposits use the existing Ethereum journal
with a narrowly validated fee profile. It binds canonical token/portal/FPC scope,
exact sender nonce and calldata and matching Approval/DepositToAztecPublic events.
The deposit secret is derived after the durable sender nonce is selected. Confirmed
prior nonces override stale provider caches. Lost signing responses remain blocked
until recovery; explicit retry reuses the same request. Canonical bridge recovery
reconstructs the public funding record without an unstored hash. These records
remain portable in the encrypted wallet recovery file.

The standalone Aztec private-fee claim uses the L2 journal before submission. Its
separate recovery action does not start PXE/proving or request Ethereum signing.
Browser controls distinguish approval, funded deposit, revert/replacement and
unknown outcomes. The native application funding fixture now uses the production
journal and the restored author's complete wallet salt.

Evidence:
- fee-integrated-006.log:207 passing integrated checks, including approval/deposit
  response loss, no duplicate sends, fresh-store portability and actual fee-engine
  L2/ETH recovery dispatch.
- fee-ethereum-anvil-004.log:real pinned Inbox/FeeJuicePortal/TestERC20 deployment,
  approval and token bridge deposit, both responses lost after mining, original
  requests recovered and balances conserved. Also retains escrow deposit/refund
  coverage. Owned Anvil and temporary files removed. No network proofs.
- fee-application-005.log points to
  ../W01/application-e9210bc0-330e-4fc6-aadf-b199a971a14e.json:real application
  claim/post proofs and native node acceptance through the updated funding helper.
  Pass in260773ms; peak sampled process-tree RSS1004656KiB. Process group,
  descendants and temporary directory are gone. Network proofs=false; local
  settlement is controlled. This does not claim the browser fee-claim recovery
  handler itself was driven by that native test.
- fee-browser-005.log:actual built browser/cross-profile recovery regression;
  one external request blocked. The later app rebuild changes only the fee-screen
  message to say the bridge message must become available before claiming.
- fee-artifacts-006.log:84 artifact/provenance checks. SDK/apps builds pass.

Binding:source-fee-006.json, artifact-manifest-fee-006.json. Root self-review only.
W03 remains active for deployment journaling, linked stale-proof replacement and
complete transaction-stage qualification. Production clearance is not claimed.
