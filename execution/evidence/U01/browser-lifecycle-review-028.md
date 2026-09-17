# U01 browser lifecycle review 028

Read-only source review; no memory measurement, browser execution or performance qualification. Aggregate 2 GiB accounting must continue to include the native node, Anvil, browser, workers and owned hosting processes. Genuine proof generation, node validation and independent canonical-state checks remain required.

## Existing handoff is substantially correct

- Board deployment, Ready and deposit/claim helpers stop their EmbeddedWallet in finally before returning. EmbeddedWallet.stop calls PXE.stop and closes walletDB; PXE.stop ends the job queue, stops block synchronization and closes its store. No additional setup wallet was found still actively running at browser handoff.
- The private-fee wallet is intentionally retained until baseline notes/balances and chain readiness are captured. u01-browser-flow then awaits privateFee.close and Barretenberg.destroySingleton before publishing browser-ready. The close clears the captured wallet variable, including the browserFixture getter; this is real release of the wallet reference, not merely a status flag.
- The read-only verification wallet is created only after browser reports closed and owned hosting stopped. Its stop runs in finally. Moving that wallet earlier would worsen overlap.
- Browser driver launches one browser, one context and one page. It reads no response bodies for diagnostics; request/error collections contain small sanitized metadata. Optional diagnostic source read is only user.html, not a copied full SDK bundle. Browser close is awaited in finally, then hosting shutdown. No tracing/video allocations were found.

## Remaining retention and supported opportunities

1. **No missed heavyweight wallet close was identified.** Keep the present ordering and await successful closure. Closing the application node or removing it from RSS accounting would invalidate this fixture, not optimize it.
2. The native worker remains alive with imported SDK/contract artifacts and the node. Earlier helper return objects retain the board transaction and the claim transaction in nonenumerable fields; these are transaction/proof bytes, not the proving witness or live PXE. The claim transaction is used to identify the original note before handoff. Replacing unnecessary earlier transaction references with hashes after their final use could reduce reachable memory, but release is GC-dependent and no size benefit is established here. Do not discard browser-submitted proof captures: those support independent acceptance checks.
3. Native setup and the node share one JS process. Supported wallet stop/async Barretenberg singleton destruction does not unload imported module graphs or guarantee immediate RSS return. A future separate setup worker could release its entire heap by exiting after exporting only necessary private fixture data, but requires deliberate state/RPC ownership work; it is not a tiny close-call correction and is not proposed before this bounded run.
4. BarretenbergSync is a separate singleton with a supported destroySingleton method; outer harness destroys it at final cleanup, not handoff. Do not add handoff destruction blindly: it is shared by node-side cryptographic operations in the same process and may be needed again. This review establishes API existence, not safe ownership isolation or a material retained size.
5. Keep diagnostic instrumentation disabled for qualification as currently supported by the driver flag. Its small sanitized arrays are bounded; no evidence supports treating it as the dominant memory cost. SDK/prover and CRS allocation must be assessed from the actual aggregate run rather than inferred from source.

## Evidence boundary

This review finds no new memory-lifecycle blocker or demonstrated saving large enough to claim the browser proof fits the cap. It does not change proof settings, CRS correctness, node validation, privacy reporting or qualification criteria. Source snapshots below make the review reproducible; concurrent root changes after this review may alter hashes.

- `scripts/u01-browser-flow.mjs`: `707fe6a037290892c1166090703ceef2f67318cbaf6e183ed208176815abea5b`
- `scripts/u01-browser-post.mjs`: `a5c78638d939fb0f0d4a583ef953d9a6d093888375c1abe8cbb7847915e02c2e`
- `scripts/u01-browser-post-verify.mjs`: `f088d90a4a6d39691559e730710d4a7fa6e2520ed37b897ce03fe39a15a2a58f`
- `scripts/w01-private-fee-flow.mjs`: `8ba4f29a9f993416419b8ebcf7361d8bd706c191254bac1c576929f0a5e401ff`
- `scripts/c01-deposit-flow.mjs`: `69c4a9bc522173263756890ccab11a0b637ed6fd1af5d460da80d962a3c095fb`
- `scripts/c01-board-flow.mjs`: `be79f63b193246681bb1d62b17d578682d5f515b061572c2ea25d9819137146a`
- `scripts/c01-ready-flow.mjs`: `ee295327d94b76fa267f9c7b290759b0a3c19cb5e3493b2ee6ec123dd54a7e98`
- `scripts/c01-real-node.mjs`: `9fe3ccd9fb91161b386c2cf80325f69c9cc42e81d62dfdae89d90187255d1870`
- `scripts/test-c01-application.mjs`: `b124add8f04c7cfc7a63c00584c3c1428a5c156fff4b9cc68af3f321597be019`
- `node_modules/@aztec/wallets/dest/embedded/embedded_wallet.js`: `c70b5d7baead8230c7e4bbe70bb4e26777055a1fc78bfb9719e70fa5cc3be792`
- `node_modules/@aztec/pxe/dest/pxe.js`: `e93807fc9202a13235669b823fe07fdccfef2cebe70834da7c19644d2f3ed669`
