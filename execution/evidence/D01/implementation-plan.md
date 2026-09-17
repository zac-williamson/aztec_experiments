# D01 implementation plan — source inspection, not acceptance evidence

Prepared while M03 qualification runs. No application change or execution
qualification is asserted here. The root must activate D01 and record any expanded
edit scope before implementation.

## Existing foundations

`apps/src/billboard/deploy/engine.js` already uses the actual CREATE sender/nonce
address if the CREATE2 proxy is absent. `shared/ethereum-journal.mjs` verifies the
creation transaction, canonical receipt, CREATE address and nonempty runtime.
W03 persists deployment/binding/activation transactions and distinguishes pending
Ready settlement from active. Keep these recovery semantics. CLI network URLs are
already explicit through `user/wallet-inputs.mjs`; legacy RPC fallback is removed.

Remaining checks are materially different: full runtime identity, independently
expected network/actors/policy, and enforceable supported release entrypoints.
Current chain comparison happens after L2 deployment. Current portal verification
checks seven getters but not Inbox/Outbox or runtime bytes. Existing config hash
binds economics/network but not policy/censor. CLI silently supplies a censor and
policy; explicit manifest input must replace these defaults for deployment.

## Proposed manifest and verification boundary

Use a strict, versioned reviewable JSON object with unknown fields rejected,
canonical decimal strings for integers, normalized fixed-width addresses/hashes,
bounded UTF-8 policy text and no secrets. Do not claim a signature unless one is
actually supplied and verified. Separate immutable deployment intent from observed
execution report so resumption cannot silently rewrite approved intent.

Intent fields:

- `schemaVersion`, `profile` (`local-test` or `operator`), SDK version, artifact
  inventory digest; board artifact/class ID, portal creation/runtime-template hashes,
  generated immutable-mapping digest, private-fee artifact/class identity.
- `network`: expected L1 chain ID, Aztec rollup version, rollup/Inbox/Outbox addresses,
  exact RPC endpoints (credentials excluded), optional separately reviewed network
  runtime hashes. Node-discovered values cannot populate their own expected values
  during the same deployment. Local fixtures may generate explicitly local manifests.
- `board`: contract salt, full minimum/maximum deposit, base cooldown, k multiplier,
  censor window, maximum save-up, censor address, policy text and computed policy
  version. Validate the actual contract numeric domains, not JS Number coercions.
- `actors`: expected Aztec deployer and Ethereum deployer addresses; no key material.
- `portal`: deployment mode (`create2` or `create`), expected address/derivation,
  creation hash, config hash; CREATE2 proxy address and pinned runtime hash when
  selected. For direct CREATE, bind the journal's reserved nonce and derived address
  in the concrete execution report before signing; resume uses that saved request.
- Existing private-fee configuration identity should be linked and verified where
  the workflow uses it; this is not an authorization to introduce a fee operator.

Report fields: intent digest, exact artifact digests, canonical observations with
block number/hash, actual board/portal addresses, deployment and Ready transaction
hashes, status (`prepared`, `deployed`, `bound-pending-settlement`, `active`), and
verification results. No report is active until all required checks pass. Persist
atomically and avoid overwriting unrelated files. Journals remain the authoritative
transaction recovery records; the report must not substitute for their reconciliation.

Preflight before wallet reads/proving where possible: validate manifest, local
artifact hashes and endpoint syntax; then bounded network reads compare Ethereum
chain ID, node info and `getL1ContractAddresses()`, rollup `getInbox()/getOutbox()`,
code existence, and expected actor identities after explicit key loading. Recheck
critical values before irreversible binding/activation. Bounded unreadable RPCs are
unknown, never permission to proceed. Check original and current board class IDs,
configuration hash, actual current policy/version and censor before ready status.
Use existing SDK artifact methods/storage layout; inspect exact getter APIs during
implementation rather than inventing method names.

## Portal runtime verification from the real artifact

Current `billboard/portal/out/BillboardPortal.sol/BillboardPortal.json` contains
`deployedBytecode.object`, `immutableReferences`, and empty runtime link references.
It does **not** contain AST. Existing out/build-info files only map source IDs;
they do not supply AST. Extend the canonical build to emit source-bound AST or a
verified immutable-name mapping; do not guess AST IDs by numeric ordering.

The constructor has nine immutable substitutions:

| Name | Independently expected 32-byte value |
| --- | --- |
| MIN_DEPOSIT | manifest minimum deposit |
| MAX_DEPOSIT | manifest maximum deposit |
| L2_CONTRACT | actual verified board address |
| ROLLUP | manifest rollup address, left zero padded |
| INBOX | manifest Inbox, cross-checked against rollup, left zero padded |
| OUTBOX | manifest Outbox, cross-checked against rollup, left zero padded |
| VERSION | manifest rollup version |
| L1_CHAIN_ID | manifest chain ID, cross-checked against Ethereum |
| CONFIG_HASH | independently recomputed application config hash |

Map AST VariableDeclaration IDs to these exact names; require the exact set of
nine, nonoverlapping in-bounds 32-byte offsets and no unresolved links. Substitute
all occurrences into the compiler runtime template and compare full runtime bytes
at the actual portal address. Reject extra/missing references, malformed bytes,
changed immutable values and changes outside immutable offsets. Getter equality
alone is insufficient because arbitrary code can imitate getters. Preserve compiler
metadata bytes. Current numeric IDs are build-specific and must not become a
handwritten permanent map. CREATE2 proxy runtime must also match its pinned runtime
before using it; absent proxy uses the existing explicit CREATE recovery route.

## Supported launch and package boundary

A Node launcher cannot prevent its own NODE_OPTIONS preload from executing.
Use a small non-Node supported entrypoint (e.g. POSIX shell wrapper) that rejects
nonempty NODE_OPTIONS/NODE_PATH, unsupported instrumentation/OTEL configuration,
and unexpected launcher arguments **before starting Node**. Invoke only the pinned,
packaged Node executable with fixed entrypoint selection and a narrowly allowlisted
child environment. Do not use shell eval, PATH-selected Node, inherited execArgv,
or arbitrary import/require flags. Explicitly select tracecontext-only or disabled
telemetry in the fresh child. Never silently accept an earlier global propagator.

The child validates the supported profile before wallet reads and uses fixed
commands (deployment, author CLI, moderator). Its subprocesses inherit the same
clean policy; daemon signer currently invokes CLI, so it also needs integration.
Direct `node ...` invocation with preloads cannot be made retroactively safe;
document it as outside the supported real-key profile and ensure packaged launch
is the only advertised operator entrypoint. This does not protect against a hostile
local administrator or arbitrary modification of the package.

The existing Aztec browser bundle is usable: `.build/sdk/sdk-manifest.json` already
inventories every bundled input; inspection found no `elliptic`, `@ethersproject`,
`@aztec/txe` or `@aztec/cli` inputs. All CLI Aztec operations load this bundle; native
CLI imports include ethers6 and fake-indexeddb. Package only explicit application
sources, SDK/workers/WASM/CRS, artifacts, pinned Node and the verified runtime
closure of ethers6/fake-indexeddb. Do not copy repository node_modules wholesale
or rely on npm devOnly. Audit actual closure/import resolution, package symlinks,
and package file inventory; reject forbidden packages/embedded dependency paths.
The daemon uses builtins and local modules but imports `scripts/toolchain.mjs`,
so include its needed runtime files or extract its small runtime pin check.
No Foundry, compiler, @aztec/cli-wallet, TXE service or test fixtures are required
in this real-key runtime package. Keep TXE in a separate disposable local-test
profile. Public browser pages are a separate static distribution, with no Node
service or testing binaries exposed.

## Verification and narrow implementation lanes

1. Shared manifest/preflight/runtime-verifier module and build-generated portal
   immutable metadata; extend deploy engine/CLI/browser to require reviewed input.
   Root owns integration. Existing recovery tests must continue passing.
2. Independently owned launch/package scripts and subprocess tests. Requires D01
   scope expansion to user CLI, daemon signer/entrypoint and package metadata before
   editing those paths. Include browser assets through existing provenance builder.
3. Extend `test-w03-deploy-engine.mjs`, `test-w03-deployment-journal.mjs` and
   `test-c01-deploy-activation.mjs`: wrong/absent proxy, CREATE actual address,
   runtime mutation/getter impostor, each immutable mismatch, every unreadable
   network/config read, wrong censor/policy/bridge, interrupted binding/activation,
   changed manifest on resume. Add one serial disposable Anvil rehearsal; reuse
   controlled application settlement if a genuine application proof is needed.
4. Launch tests through the real wrapper: NODE_OPTIONS --require/--import sentinels
   must not execute; bad propagation and arbitrary entrypoint flags fail before
   sentinel wallet reads. Fresh supported child cannot inherit a propagator.
   Inspect clean package closure and exercise real bundled CLI entrypoints without
   repository node_modules; absence of ethers5/elliptic/TXE must be enforced.
5. Independent diff/assumption review, affected rebuild/checks, source-bound D01
   evidence. Do not equate local manifest verification with current mainnet approval,
   external audit, publisher signature or completed release qualification.
