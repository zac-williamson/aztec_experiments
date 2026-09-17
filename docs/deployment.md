# Reviewed deployment configuration

Prepare public intent in the controlled build checkout, then review the resulting
manifest before loading wallets. This is a reviewable JSON record, not a signed
release attestation. Current network approval remains a separate release gate.

The intent contains exactly these fields; all integer values are decimal strings:

- `schemaVersion`: `1`; `profile`: `local-test` or `operator`.
- `network`: `nodeUrl`, `ethRpcUrl`, `chainId`, `rollupVersion`, `rollup`,
  `inbox`, `outbox`. Obtain and review these independently of the deployment's
  live discovery. URLs cannot contain credentials, queries or fragments.
- `actors`: `aztecDeployer` and `ethereumDeployer`, the intended wallet addresses.
- `board`: `salt`, `minDeposit`, `maxDeposit`, `baseCooldown`, `kMultiplier`,
  `censorWindow`, `maxSaveUp`, `censor`, `policy`. Deposits are in wei; cooldown
  and censor window are in seconds. Salt can be zero. Economic values must be
  positive and fit the contract's checked integer bounds. Policy is literal text,
  at most 1,488 UTF-8 bytes, not a model prompt or a filename.

Use lower-case fixed-width addresses: 20 bytes for Ethereum addresses and 32 bytes
for Aztec addresses. No private keys belong in this file. There are intentionally
no implicit network, censor or policy defaults.

After building and checking the pinned artifacts, prepare the manifest offline:

```sh
node scripts/prepare-deployment-manifest.mjs intent.json deployment.json
```

The utility refuses an existing output and adds the actual board artifact hash,
class ID, portal creation hash and generated runtime metadata hash. It checks
current SDK build provenance. Review both intent and these artifact identities
against the candidate you intend to deploy; never auto-approve values returned by
the same endpoint they are intended to authenticate.

In the prepared operator package:

```sh
./scripts/operator-launch.sh deploy --manifest /absolute/path/deployment.json \
  --aztec-wallet /absolute/path/aztec-wallet.json \
  --eth-wallet /absolute/path/ethereum-wallet.json \
  --report /absolute/path/deployment-report.json
```

Wallet input files must satisfy the application's private-file checks. Preserve
the encrypted wallet backups and scoped transaction journals. Deployment requires
the deployer's own fee funds; anonymous author transactions use the separate
ownerless private-fee contract. This manifest does not deploy or approve a fee
service, nor does it qualify a moderation model.

The browser deploy page accepts the same manifest and provides a downloadable
public execution report. Inspect its network, actors, deposit limits and policy
before clicking Deploy. The selected Ethereum wallet must be on the manifest's
chain. Configure the author page for the same network before using its portal.

Only `active` means activation was observed. `pending-settlement` preserves the
binding transaction hash but leaves setup incomplete. Resume the same manifest
and identities; supply `--ready-tx HASH` if the original binding hash is needed.
`--retry-ethereum true` explicitly permits retrying a saved Ethereum request with
its original nonce. Do not change the manifest or erase recovery records to work
around an unresolved transaction. Full portal bytecode, bridge references, board
configuration, censor and policy are checked again before activation. Unreadable
or mismatched critical reads fail closed.

The report is public and separate from recovery storage. It cannot authorize a
replacement transaction or prove current readiness after later chain changes.
Existing reports must match the same intent before replacement. Independent audit,
current target-network compatibility and final release qualification remain required.
