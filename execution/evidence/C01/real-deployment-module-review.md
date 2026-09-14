# C01 direct local deployment helper — source review

2026-09-14. Authored `scripts/c01-real-deployment.mjs`, SHA256 `716ae8d4eddfdddffb7c05347ea88baeef86fe780fb308d6898e1dabe6cf07f7`. No execution, compilation, network, or deployment occurred in this lane. Root owns bounded runtime qualification and teardown.

Exports `deployC01RealProtocol({rpcUrl, privateKey, config, genesisArchiveRoot, fundingNeeded})`, returning `{deployment, observation}`. `deployment` is the actual SDK object, including its signing client: never serialize it. `observation` is the sanitized evidence. The helper wraps errors without upstream messages/causes because Forge errors can include arguments containing fresh signing keys.

The caller supplies fresh Anvil and identities, config.l1ChainId31337, explicit genesis root/funding bigint, LOG_LEVEL=silent, and an absolute supervisor-verified FORGE_BIN. RPC accepts only explicit numeric loopback HTTP endpoints; it checks actual chain31337 and Anvil client identity before deployment. The parent must maintain a trusted local endpoint and minimal environment for the SDK's subsequent RPC/Forge calls; the identity checks are not an OS network sandbox.

The direct installed `deployAztecL1Contracts` API is called, not the local-network helper which forces a mock verifier. Only known L1 configuration keys are selected from config. VK tree root and protocol-contract hash come from installed matching packages, genesis is caller-supplied, realVerifier is unconditionally true, and existing external token reuse is forbidden. Optional initialValidators entries use the installed shape `{attester:EthAddress, withdrawer:EthAddress, bn254SecretKey:SecretValue<bigint>}`. One fresh validator with nonzero scalar1 and committee size1 is API-compatible in source; deployment/committee acceptance has not yet been tested.

## Correct verifier artifact and exact runtime comparison

The helper pins both the complete artifact and its source, checks metadata compilationTarget and source keccak agreement, and compares the entire on-chain runtime including metadata. It masks no bytes. The pinned verifier has an empty constructor, no link references and no immutable references; any future artifact requiring linking or immutable replacement is rejected rather than guessed.

- Correct artifact: `node_modules/@aztec/l1-artifacts/l1-contracts/out/HonkVerifier.sol/HonkVerifier.json`, SHA256 `3fba3b75fdb2eec44554cefeb387704caa65f05a3eb1b4049bf2fe6b9d3367df`.
- Compilation target: `generated/HonkVerifier.sol:HonkVerifier`; actual runtime16,996bytes.
- Source SHA256 `5aeb653a8c004674f226f751c6ea09d316593daaadac4dcecd1e2d44749b35bd`.
- Runtime SHA256 `ecb6312b3a0b10a531d2d15dd90589841b27602da93afe0bead20d6184bab1f2`.

The similarly named `out/generated/HonkVerifier.sol/HonkVerifier.json` is a coverage mock targeting `src/mock/coverage/generated/HonkVerifier.sol`; it is deliberately not accepted. `out/deploy/HonkVerifier.sol/HonkVerifier.json` targets the separate script source and also is not silently substituted.

After deployment, reads at one L1 block bind the Rollup's actual getEpochProofVerifier result to the exact runtime, require mutual Rollup/Inbox/Outbox address agreement and nonempty code, and compare on-chain rollup version with the SDK return. Code hashes, identity block/hash and source pins are recorded; pinned artifact/source are rechecked after deployment. This is verifier identity evidence, not proof acceptance or full Rollup/bridge bytecode qualification.

## Integration limitations to retain

The SDK prepares a temporary deployment checkout and installs exit cleanup. Parent must put TMPDIR inside its owned private directory and clean that directory after process teardown. The SDK passes fresh test keys through its Forge command/environment; parent logs must remain sanitized. SDK deployment sets Anvil's timestamp interval and may mine to slot1; before/after timestamps and that behavior are recorded, with no proven-state/root override.

Crucially, the installed deployment API only forces a production Foundry rebuild/profile on mainnet. On31337, the bundled default Foundry mapping uses `@aztec-blob-lib/=src/mock/libraries`, whereas the production profile maps the real rollup library. This module therefore explicitly returns `productionBlobLibQualified:false`. The first bounded deployment/real-verifier identity check may proceed, but root must resolve and separately verify that profile/library issue before representing a later epoch/bridge test as genuine protocol acceptance. No mock mapping was patched in this lane, and no epoch claim is made.

Exact source references: installed `ethereum/src/deploy_aztec_l1_contracts.ts:284` API; `:162` prepared checkout; `:210` validator data; `:572` REAL_VERIFIER; bundled `script/deploy/DeployRollupLib.sol:24,73–78` actual generated verifier construction; bundled foundry.toml default/production remappings. No dependencies or production board sources were edited.

## Bounded follow-up: production-profile wrapper feasibility

Read-only follow-up requested by root: installed `forge_broadcast.js` invokes FORGE_BIN with `script` plus the actual deployment arguments in the SDK's prepared temporary cwd. An explicitly pinned wrapper can validate that cwd belongs to the parent-owned `.foundry-deploy-*` tree and the script is exactly `script/deploy/DeployAztecL1Contracts.s.sol`, export FOUNDRY_PROFILE=production, run the absolute pinned Forge `build script/deploy/DeployAztecL1Contracts.s.sol --force`, require successful completion, then exec that same binary with the original arguments. This mirrors the SDK's `maybeForgeForceProductionBuild`, which otherwise only executes for chain1, and overrides the SDK-cleared profile at the final actual Forge invocation. The wrapper must not echo signing arguments. The forced build falls inside the broadcaster's default120-second Anvil deadline; parent infrastructure bounds and evidence must account for it explicitly. Actual compiled/link/runtime evidence remains required to qualify production BlobLib. No wrapper was implemented or executed in this lane.
