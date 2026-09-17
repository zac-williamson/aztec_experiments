# U01 public browser configuration — implementation plan, not acceptance

## Minimal shared public record

Use one bounded, versioned, exact-key record, shared by author, moderator, fee-funding and public-reader pages:

```json
{
  "schemaVersion": 1,
  "network": {
    "nodeUrl": "https://node.example/",
    "ethRpcUrl": "https://ethereum.example/",
    "chainId": "1",
    "rollupVersion": "5",
    "rollupAddress": "0x…20 bytes"
  },
  "board": {
    "portalAddress": "0x…20 bytes",
    "contractAddress": "0x…32-byte Field"
  },
  "privateFee": {
    "contractAddress": "0x…32-byte Field",
    "gasSettings": {
      "gasLimits": {"daGas": "…", "l2Gas": "…"},
      "teardownGasLimits": {"daGas": "…", "l2Gas": "…"},
      "maxFeesPerGas": {"feePerDaGas": "…", "feePerL2Gas": "…"},
      "maxPriorityFeesPerGas": {"feePerDaGas": "…", "feePerL2Gas": "…"}
    }
  }
}
```

This combines existing shapes; it introduces no fee actor. Fields are public. Use canonical decimal strings, nonzero lowercase addresses and field bounds. Gas/teardown components are u32; prices are u128; preserve `snapshotGas` checks for positive maximum charge, teardown ≤ main limits, priority ≤ maximum prices and total maximum < 2^128. Display the maximum charged fee and existing no-unused-gas-refund behavior. The current CLI checks exact fee top-level keys only; nested gas validation is in `private-fee-client.mjs`, so browser import needs an exact nested-key validator rather than claiming one already exists.

RPC URLs must use HTTP(S), be bounded and exclude userinfo, query and fragment, matching D01 endpoint policy. Do not import API keys. Operator-supplied credential-bearing URL paths must not be distributed as public configuration. Do not store wallets, funding-claim salts/secrets, recovery records, author identities or request objects in this record. Reject unknown fields recursively rather than persisting arbitrary imported objects.

The board/fee address and network identity need not be duplicated elsewhere. Artifact/class identities are supplied by the built release and checked, not trusted merely because a config says they are correct. For read-only access the public reader can consume the network/board subset; lack of private-fee config must disable wallet actions, not public reading. Fee funding still requires the configured network; it derives Fee Juice portal/token identities from that verified network, not from unrelated user input.

## Import and authoritative checks

Provide “Import board configuration” plus a deployment-report adapter. D01 browser reports already contain `{schemaVersion,manifest,l2Addr,portalAddr,readyTxHash,configHash,intentDigest,policyVersion,status}`. Validate the manifest using `validateDeploymentManifest`, recompute its canonical intent digest, and extract network/board fields; combine with the existing public private-fee config input. D01 reports do **not** currently contain fee configuration, so do not invent it or silently use gas defaults. An `active` string in an imported report is historical metadata, not current chain authority. An optional report view can show policy/censor/economics without copying these into the minimal connection record.

Reuse existing checks:

- `connectPublicFeed`: Ethereum chain identity, portal→board/rollup/version/chain, both original/current board class IDs against built metadata, checkpointed reverse portal/config binding and public event source scope. Compare its resulting scope to every independently imported expected network/board field; today it has no expected-scope argument, so this comparison must be added by the adapter.
- `derivePrivateFeeAddress` / `preparePrivateFeePayment`: deterministic ownerless fee contract from bundled artifact, optional deployed instance original/current class identity, computed address, wallet/node chain agreement and available private balance or authenticated funding claim. A fully private contract need not be publicly deployed; absence of a node instance alone is not failure.
- D01 `verifyDeploymentInputs`/network preflight and portal runtime verifier remain deployment checks. Public-feed getter equality does **not** provide D01 full-byte portal runtime assurance. If UI claims full deployment verification, retain/import the full reviewed manifest and run those checks explicitly. Otherwise label the result as verified connection and show the limited scope.

## Navigation, reload and operation safety

Persist only the validated public projection under one versioned same-origin storage key. Load/validate before wallet buttons or network-dependent initialization. On unavailable/corrupt storage show an import state; do not fall back to mainnet or mix partial settings. Export the same normalized public record. Keep links ordinary same-origin links: never place wallets, fee-claim secrets or complete recovery files in URLs. Cross-origin navigation requires a fresh import, not implicit secret transfer.

Expose a single immutable config snapshot plus monotonically changing revision. Replace config atomically; clearing it must disable wallet actions and reset the reader. A storage event from another tab invalidates the current operation snapshot and requires explicit refresh/reselection. Guard before proving, before wallet signing/sending and after asynchronous reads. A changed config must not delete existing encrypted transaction journals; saved transactions remain recoverable under their original scope. UI loading state should prevent duplicate imports while work is running, but the revision guard is still required for cross-tab changes.

## Existing consumers to change together

- `shared/app-env.js`: replace captured `const ETH_RPC_URL`, hardcoded Ethereum fallback, `_getNodeUrl` mainnet fallback, `_getApiKey`/`setupRpcAuth` inherited `window.RPC_CONFIG` authority, `buildConfig`'s uninitialized `window.billboardPrivateFee`, and `makeCallEngine` identity capture. Use a full validated config snapshot/revision; preserve wallet-generation and signer-account guards.
- `shared/aztec-lib.js:getNodeUrl` currently prioritizes build-time `RPC_CONFIG` over the page input. Route it through the same config accessor. Inspect the legacy Ethereum-mainnet Fee Juice constants near line 746 before retaining any funding fallback; the current private-fee engine derives contracts from the node and should not regress to those constants.
- User/censor templates have hidden hardcoded mainnet `nodeUrl` inputs. Public feed defaults to localhost endpoints. Replace authoritative defaults with explicit import/connection state.
- User/censor `refreshBillboard` captures only portal + node; add Ethereum endpoint and config revision to the stale-response guard. Reset feed pagination/count on change. Wallet-button initialization currently receives captured `ETH_RPC_URL`; reinitialize/invalidate existing signers when the configuration changes.
- Fee page uses `buildConfig`, wallet-button Ethereum URL and acknowledgement keys containing only wallet + node. Include full verified network/fee identity; do not reuse acknowledgements across config changes. Existing public funding recovery storage is separate and must remain scope-checked.
- Deploy page has its own reviewed manifest. Its wallet setup must use that manifest's endpoints, not a previously imported author config; keep D01 manifest authority intact. Its downloaded report can seed the public config adapter after successful verification.
- `apps/build.mjs` currently emits `window.RPC_CONFIG` from an example file (or an explicitly noncanonical override). Build output may provide a public candidate config, but it must pass the same validator and must not silently override a user's selected record. Include the new config helper/import UI in provenance and packaging as appropriate.

## Required acceptance probes

Real built-page import/reload/navigation across author→fees→moderator; no console injection. Reject malformed nested config and secret-bearing fields; verify localStorage contains only the public whitelist. Wrong chain, wrong portal/board/class and wrong fee address fail before signing. Config change during public read cannot render old results; change during proof/signing or via another tab blocks send. Existing encrypted recovery still works after switching back. Public reading works without a wallet or fee setup. UI never labels an imported report alone as live chain verification.
