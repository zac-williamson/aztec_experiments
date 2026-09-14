# P04 storage API and SDK verification

The application targets a fresh deployment, following the user's clarification.
It now exports `openPXEStore(config, schemaVersion?, log?)` and
`getPXEStoreIdentity(config, schemaVersion?)` from one shared module,
`shared/sdk-store.mjs`. There is no legacy `createIndexedDBStore` alias or
migration workflow. Existing unrelated databases and files are not removed.

The actual installed Aztec 5.2.0 IndexedDB entrypoint no longer exports
`createStore`. The shared implementation calls its verified
`AztecIndexedDBStore.open(log, name, false)` API. PXE schema 13 comes directly
from the installed PXE metadata module, not a separately copied constant.
That internal metadata path is pinned and required in the SDK provenance
manifest; a future upstream path change must be handled explicitly.

Configuration requires the node's numeric `l1ChainId`, rollup address, complete
account address, and application data namespace. The database name encodes all
four plus the PXE schema version and store type as an unambiguous JSON tuple.
Canonical address casing preserves stable identity. A different chain, rollup,
account suffix, namespace, or schema selects a separate store. Opening a store
validates its identity marker and fails without clearing it if the marker is
missing or inconsistent. Invalid configuration is rejected before creating a
database. No automatic clearing or schema migration occurs.

The shared setup and all three engines supply actual node/account fields. The
browser environment and all three CLI factories call the new API. The censor
engine is a symlink to the user engine. The SDK build manifest now derives its
Aztec version from the verified toolchain pins. Its validator requires both
the storage adapter and upstream PXE schema metadata among recorded inputs.

Verification on Node 24.15.0 and installed Chrome 152.0.7977.84:

- 22 actual SDK store tests using disposable fake-indexeddb databases passed:
  reopen, five isolation dimensions, input validation, metadata preservation,
  unrelated database handling, and cleanup.
- The actual built SDK adapter in Chrome preserved a sentinel through page
  reload, isolated all five dimensions, reopened each store, and deleted only
  its disposable test databases. None remained on the disposable test origin.
- All 33 SDK manifest regressions passed, including stale or omitted adapter
  and upstream schema inputs. The actual new manifest passed verification
  with 1,361 inputs and eight outputs.
- All five offline CLI SDK cases passed. The three actual CLI loader functions
  load the new bundle and exercise its store opening/reopening/cleanup, hashing,
  disposable identity derivation, and Buffer behavior. Two wallet-generator
  cases capture generated output in memory. These retain the existing bounded
  function extraction harness; they do not run CLI `main()` or inspect wallets.
- The existing browser SDK smoke passed local CRS verification and initialization
  through both shared adapters, worker initialization/destruction, SQLite
  sentinel storage, hashing, and cross-origin isolation.

Evidence files: `storage-node-tests.log`, `storage-browser-tests.json`,
`sdk-manifest-tests.log`, `cli-sdk-smoke.json`, `sdk-browser-smoke.json`,
`sdk-build.log`, and `storage-source-hashes.json` in this directory. The
browser storage evidence binds the tested bundle hash. The source record binds
the modified sources and the actual installed upstream API files.

The first browser launch found no Playwright-downloaded browser. Repeating with
the already installed Chrome succeeded; no browser download was needed. The
build emitted a dependency deprecation warning for `fs.Stats`, with a successful
build result. Neither is an application security finding.

These checks use disposable records and test identities, without existing
wallet reads, remote RPC, transactions, PXE synchronization, or proof generation.
CLI fake-indexeddb evidence is in-process only; durable CLI persistence, backup,
and recovery for new users remain W02. IndexedDB remains the explicitly chosen
deprecated upstream backend for this migration; a backend replacement is not
claimed here. Broader P04 contract, protocol, canonical-address and real-proof
verification belongs to the integrating work package.
