# Wallet acknowledgement and canonical Ethereum evidence

130 reproduces an integration defect using pinned ordinary MetaMask: wallet-backed ethers transaction response has chainId=null. The configured Ethereum RPC returns the successful canonical approval on31337 with exact sender, target, nonce0, calldata, value0 and allowance1000.128/129 failures retain prior evidence and diagnose progressively; no fee signing success is claimed from them.

The journal now treats the returned valid hash as submission acknowledgement, persists it, then applies the unchanged strict canonical transaction/receipt/block/event validator. No missing value is invented and no mismatched canonical transaction is accepted.

Fee funding requires an explicit configured Ethereum provider for all reads. The browser fee engine owns/destroys that provider; the CLI and fixtures pass it explicitly. User/deployment engines likewise read through their configured RPC; deployment reuses its existing preflight reader. Wallet providers remain responsible for signing and independent signer-network checks.

The null-chain acknowledgement regression fails before the repair and passes afterwards. Tests also require configured-reader separation, reject missing provider and wrong signer network, and retain canonical chain/nonce/target/calldata/receipt rejection checks.128 focused checks passed before the final two contract reader bindings; subsequent29 user/deployment checks cover those final bindings. The broader existing component hierarchy passed. SDK/apps rebuilt and artifact/harness checks passed. Independent application review approved the final bindings and reader lifetimes; independent harness review approved exact localRPC CSP/request allowlisting.

One tightened user test initially failed because its own simulated signer instantiated the Portal double without the newly required reader. That fixture invocation was corrected; failure and corrected logs are preserved. This was a test fixture defect, not a production regression.

131 is the actual extension acceptance run, recorded separately. A full application lifecycle against these changed engines is still required after it.

131 completed both genuine Ethereum submissions with correct balances but the test failed on a nonexistent AztecAddress.fromString API. The pinned SDK exposes fromStringUnsafe and isValid; the corrected parser was checked independently before132.132 PASS:23642ms,3728688KiB aggregate peak, two exact user transactions, canonical approval/deposit receipt checks, persisted recovery reread equals original, no duplicate recovery submission, no PXE/CRS request, complete owned-process/profile cleanup. No claim of an Aztec proof in this focused extension test.

133 reruns the existing installed-Chrome full application journey against this source, with real Aztec application proofs. It remains distinct from the extension-specific signing check.

133 PASS integrated installedChrome journey:373183ms (6m13s),3028208KiB aggregate peak, genuine application proofs, canonical deposit/claim/post/screen/exit/refund checks and complete process/temp cleanup. Report: application-4f979076-a680-496e-a073-758c43d2cadc.json. This uses the existing disposable Ethereum adapter;132 separately verifies the real MetaMask signing route.

134 PASS clean-worker rerun without diagnostic monkeypatches: 23685ms, 3509792KiB peak, all original acceptance checks retained and complete cleanup.
