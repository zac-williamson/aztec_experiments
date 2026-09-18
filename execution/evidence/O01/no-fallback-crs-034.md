# No-fallback CRS application path 034

Implemented; deliberately not validated or tested. Root coordinates the first validation and stops on any failure.

- Runtime `shared/crs-client.js` requires the verified local derived G1, G2 and Grumpkin files in that order. A missing, wrong-size or wrong-hash file immediately rejects. It neither reads compressed G1 as an alternative nor requests a CDN. Complete-source SHA-256 verification still precedes the selected BN254 prefix; provenance and point-count checks remain.
- `scripts/build-crs.mjs` downloads from the single declared primary URL, with no alternate destination or retry after failure. Existing output/cache corruption now throws instead of triggering repair from another source. Absent files still follow initial provisioning (verified cache, then one pinned download; absent derived G1 is generated once). Historical fallback URL manifest metadata is validated but never used to download.
- Consumer tests now cover missing/corrupt/truncated required files, immediate stop with no later reads/network/prover calls, full-source validation outside the retained prefix, malformed metadata, and SRS response rejection. Build tests require first-download rejection without a second request and explicit rejection of corrupt existing cache bytes.

Inspected production callers in `shared/private-pxe.mjs`: both browser and CLI supply a local loader and hash function already. Their previously rejecting `fetch` callback is now unused and harmless. No caller API change, manifest migration, package.json edit, or asset regeneration is needed for this change; normal bundle rebuild remains required before packaged execution. Relevant existing test entries are `scripts/test-crs-consumers.mjs` and `scripts/test-crs-build.mjs`.

Integration simplification: removed the secondary CRS cache and source-precedence chain. The build verifies existing output; only absent build output is created from the single pinned download (or local derivation for G1). Corrupt output fails immediately. Runtime never downloads or derives. Invalid shared field-array decoding now throws rather than returning an empty array.
