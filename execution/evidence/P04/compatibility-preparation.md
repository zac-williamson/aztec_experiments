# P04 compatibility preparation — V5 maintenance upgrade

Prepared read-only on 2026-09-12 UTC while P03 verification was running. This note does not start or complete P04, change package pins or the requested network, install dependencies, or clear X03. Read inputs included P04's acceptance plan, P01's product specification, the existing source/build configuration and P02's current-network-inputs record.

## Recommendation

Target a coordinated **Aztec 5.2.0** application/tooling upgrade, with **Noir 1.0.0-beta.25**, for P04's compatibility implementation. Preserve the reproducible 5.0.0 baseline and its regression evidence. Moving within V5 does not retarget to V6. This recommendation is about supported version compatibility, subject to the actual migration tests below; it is not permission or assurance to deploy production funds.

Official 5.1.0 notes, dated 22 July 2026, call the release required for contract developers. They change note selectors to use packed-field layout and move the canonical HandshakeRegistry to bind owner identity into its initialization state. Audit selector use and registry assumptions rather than treating the upgrade as an artifact-only replacement. [Official 5.1.0 release](https://github.com/AztecProtocol/aztec-packages/releases/tag/v5.1.0).

Official 5.2.0 notes, dated 17 August 2026, describe interoperability with 5.1.0 nodes and continued support for 5.1.0 contracts. Protocol constants remain unchanged; protocol circuits/contracts are distributed as pinned prebuilt artifacts rather than rebuilt with the new application compiler. The main contract-source change is public visibility for note types declared inside contracts. The release also adds client robustness and browser CRS fixes. Its compatibility rationale is stronger than simply selecting the newest tag: this maintenance release explicitly targets the currently advertised rollup without a coordinated protocol upgrade. The release page remains marked latest. [Official 5.2.0 release](https://github.com/AztecProtocol/aztec-packages/releases/tag/v5.2.0).

The network reference still advertises 5.1.0 on Alpha/testnet. Mainnet Ethereum chain ID `1` is distinct from Aztec rollup version `4248422647`; testnet uses `11155111` and `1821665230` respectively. The documented 5.2 interoperability explains the version-table difference; it does not establish which software an individual RPC currently runs. [Official network reference](https://docs.aztec.network/networks).

## Matched toolchain, verified from primary metadata

The official version manifests returned:

| Tool | 5.1.0 installer manifest | 5.2.0 installer manifest | P04 proposal |
| --- | --- | --- | --- |
| Noir | `v1.0.0-beta.22` | `v1.0.0-beta.25` | beta.25 |
| Foundry | `1.4.1` | `1.4.1` | Keep 1.4.1 |
| Node | `24.12.0` | `24.12.0` | Retain existing exact 24.15.0 pending affected tests |

Sources: [5.1.0 versions manifest](https://install.aztec.network/5.1.0/versions), [5.2.0 versions manifest](https://install.aztec.network/5.2.0/versions). Other unchanged manifest entries are cmake 3.28.3, clang 20.1.8, zig 0.15.1, rustc 1.85.0 and wasi-sdk 27.0; they are not new requirements to build this application from published packages.

Published metadata confirms `@aztec/txe`, `@aztec/aztec.js`, `@aztec/pxe` and `@aztec/bb.js` all exist at exact 5.2.0. TXE pins its PXE, simulator, node, prover, accounts, constants and standard/protocol-contract dependencies to that same version. The published TXE/SDK/PXE Node engine constraint is `>=20.10`; retaining this project's newer Node 24.15.0 satisfies that declared range and the installer major/minor, but successful local/browser/native execution still needs verification. The tagged monorepo package files contain the development placeholder `0.0.0`; use published package metadata when verifying actual release versions. [Published TXE metadata](https://registry.npmjs.org/@aztec/txe/5.2.0), [SDK metadata](https://registry.npmjs.org/@aztec/aztec.js/5.2.0), [PXE metadata](https://registry.npmjs.org/@aztec/pxe/5.2.0), [bb.js metadata](https://registry.npmjs.org/@aztec/bb.js/5.2.0).

Immutable reference inputs verified through official GitHub metadata:

- Aztec `v5.2.0` annotated tag object `f323b4d68278eeb3c6b444f93e5577d601a6bf2c`, resolving to commit `49a592109ec4f18d79212b43d621891aaf36f7b6`. [Official tag object](https://api.github.com/repos/AztecProtocol/aztec-packages/git/tags/f323b4d68278eeb3c6b444f93e5577d601a6bf2c).
- Noir `v1.0.0-beta.25` resolves directly to commit `75061fab15986eedee4e7d9104ff87dd9fa4ca10`; release published 22 July 2026. [Official Noir tag reference](https://api.github.com/repos/noir-lang/noir/git/ref/tags/v1.0.0-beta.25), [official release asset metadata](https://api.github.com/repos/noir-lang/noir/releases/tags/v1.0.0-beta.25).

The Noir release API supplies these SHA-256 asset digests for the project's four bootstrap platforms. These are observed publisher metadata, not downloaded-byte verification in this preparation lane:

| Archive | SHA-256 |
| --- | --- |
| `nargo-aarch64-apple-darwin.tar.gz` | `63ed453d09a65bfc78eef63252423126959d41c85de0da0cf54289c5e266ceb5` |
| `nargo-aarch64-unknown-linux-gnu.tar.gz` | `4e86553af99e87c047bae40f1315234709e8d815f6158f3b8a00bf68f512a2b7` |
| `nargo-x86_64-apple-darwin.tar.gz` | `660567c645f841389b1e37ddebd4f6c75417763018ea034e08b28338bf27673c` |
| `nargo-x86_64-unknown-linux-gnu.tar.gz` | `bf3410ab94933a4aebd1f988b67ae974c6c227f9456ed0f1e4a3716bb8a30fe9` |

Their URL prefix is the official `https://github.com/noir-lang/noir/releases/download/v1.0.0-beta.25/`. Bootstrap must verify downloaded bytes and the resulting executable's version/commit before using it.

## Concrete local compatibility seams

1. **Version/source locks.** Change the root's direct and development `@aztec/*` versions together, including TXE, CLI, prover and wallet packages; update the portal's L1 artifact dependency and both package locks. Change both local Nargo Aztec tags from `v5.0.0` to the verified 5.2 release. Rebuild `noir-dependencies.json` from recursively resolved, independently verified source archives, retaining the P02 source-integrity checks. Update `toolchain.json` and compiler asset pins. `scripts/build-sdk.mjs` currently writes a hardcoded `aztecVersion: '5.0.0'`; derive it from the verified pin when migrating. Refresh all affected SDK/contract/CRS manifests, workers and artifacts.

2. **Storage API is a definite build break to address.** `shared/sdk-entry.mjs` exports `createStore as createIndexedDBStore` from the deprecated IndexedDB entrypoint. In tagged 5.2.0 source that entrypoint exports `AztecIndexedDBStore` and `openTmpStore`, with no `createStore`. Its class API is `AztecIndexedDBStore.open(log, name?, ephemeral=false)`. [Tagged IndexedDB exports](https://raw.githubusercontent.com/AztecProtocol/aztec-packages/v5.2.0/yarn-project/kv-store/src/deprecated/indexeddb/index.ts), [tagged store implementation](https://raw.githubusercontent.com/AztecProtocol/aztec-packages/v5.2.0/yarn-project/kv-store/src/deprecated/indexeddb/store.ts). The current shared setup, all three CLIs and browser template adapters call the old alias. Define a single explicit adapter and namespaced store identity rather than replacing the function name while passing the old config object. The migration notes describe selecting stores by L1 chain, rollup address and schema version, and the named-store API. IndexedDB is deprecated; a broader persistence backend switch should remain coordinated with W02 rather than silently resetting user state. [Official migration notes, 5.0.1](https://docs.aztec.network/developers/docs/resources/migration_notes#501).

3. **Note changes are partly already satisfied.** Current `PostNote` and `DepositNote` declarations in `billboard/billboard_contract/src/main.nr` are already `pub`, derive `Packable`, and have scalar fields. The local contract/test source search found no `properties()`, `select()` or `sort()` calls and no deprecated `as_slice` or `std::hash::keccak` references. This is a bounded source observation, not a successful beta.25 compilation. Future P04 note layouts/selectors must have executable packed-layout fixtures before C01–C06 implementations diverge.

4. **History restrictions do not automatically fix B05.** The 5.0.1 migration renames the nullification-history helpers with `local_` and constrains those helpers to the executing contract. This project instead uses `assert_note_existed_by`. Tagged 5.2.0 implementation still derives the silo from `hinted_note.contract_address` and proves inclusion; it does not add this application's intended owner/slot/deposit-chain authorization. C02's explicit bindings and adversarial note tests remain required. [Tagged 5.2.0 note history implementation](https://raw.githubusercontent.com/AztecProtocol/aztec-packages/v5.2.0/noir-projects/aztec-nr/aztec/src/history/note.nr).

5. **Canonical assumptions and browser boundaries.** Reconcile the newly installed standard-contract artifacts and computed HandshakeRegistry address, confirm intended current versus legacy handshake behavior, and record protocol contract/root comparisons. Exact new registry address was not independently derived in this lane; do not copy an unverified address into deployment configuration. Inspect all strict worker URL relocation matches in `scripts/build-sdk.mjs` before building; compare the new BB CRS loader, expected formats and bounds to `crs-manifest.json`. Rerun native/browser SRS adapters rather than presuming the 5.0 byte assumptions transfer.

6. **Preserve P01 product invariants.** The upgrade cannot substitute for intended portal authentication, private deposit-chain identity, authenticated note ancestry, independent post identity/public ordering, eligible finite exit, shared fee privacy or durable success-based transaction/moderation state. Freeze these interfaces only after the compatible SDK/compiler shape is known. Current unsafe receipt baseline assertions must remain honestly classified until W03 repairs them; a new SDK does not repair the application's custom polling branch by itself.

## P04 execution order and evidence to require

- Resolve and pin the full matched release set and recursive Noir source origins, then inspect all changed API boundaries above before editing consumers.
- Compile with beta.25 and matching 5.2 TXE/prover; regenerate artifacts and source/SDK/CRS manifests. Compare two clean builds, preserving intentional protocol artifact pins and explaining application artifact changes.
- Run the current meaningful Noir/TXE inventory, portal source/generated/bad-bytecode regressions, SDK/CRS browser and CLI checks, process isolation and moderation suites, and receipt/shell/history baseline harnesses. Add a storage adapter test covering isolated names across networks/schema versions and actual browser store open/reopen/cleanup. Do not count a wasm initialization test as proof generation.
- Verify matched canonical-contract/selector fixture semantics and source hashes, then publish the coordinated interface fixture/schema decisions required by P04-A01–A04. Passing this migration supplies P04-A05 evidence only when actual affected checks pass.

## Deployment pause remains separate

The official August 7 notice still asks teams planning a V5 deployment to wait for further guidance because the proving-system incident can affect funds and state. Current official-page searches did not locate a later clearance. The 5.2 maintenance notes do not claim to lift that guidance. X03 therefore remains unfulfilled; local migration/hardening can continue. Preserve the requested V5 target unless the user explicitly decides otherwise after a documented alternative assessment. [Official V5 incident notice](https://aztec.network/blog/alpha-v5-proving-system-vulnerability).

Unknown here: live node build hashes, canonical registry/L1 state, downloaded 5.2 package/compiler binary equality, actual SDK/browser compatibility, real proof acceptance, deployment clearance and the eventual V6 path. No RPC calls or L1 transactions were performed. Only this preparation note was written.

## Retrieval limitations

The web fetcher could not open the old `install.aztec-labs.com` version URLs; a sandboxed direct request also lacked DNS access. A permitted read-only public HTTPS metadata request to `install.aztec.network` succeeded for both exact manifests. GitHub release pages, tagged source and npm publisher metadata provided the remaining inputs. A few guessed source paths returned 404; the IndexedDB path was corrected to `src/deprecated/indexeddb` and verified. Missing generated canonical-contract source was not replaced with a guessed address. No installer script was executed and no package was installed.
