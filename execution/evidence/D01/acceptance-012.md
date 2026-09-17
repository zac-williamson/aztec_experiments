# D01 acceptance — deployment verification and supported operator package

Executed in the application checkout on macOS arm64 with pinned Node24.21.0,
Aztec5.2.0, Foundry1.4.1 and the existing verified contract/CRS inputs. Heavy jobs
were serialized. No public deployment, real funds or network epoch prover used.

## Observed results

- SDK build regenerates immutable mapping from isolated Solidity AST and checks
  canonical creation/runtime/source identities; frontend rebuild passes.
- `node --test scripts/test-deployment-manifest.mjs scripts/test-portal-runtime.mjs
  scripts/test-w03-deploy-engine.mjs scripts/test-w03-deployment-journal.mjs
  scripts/test-c01-deploy-activation.mjs scripts/test-artifacts.mjs
  scripts/test-dependency-*.mjs censor-daemon/test_signer.mjs
  censor-daemon/test_daemon.mjs`:334 checks pass in4.3seconds. Later signer-only
  run adds the actual clean operator child regression:130 signer checks pass.
- `node scripts/test-deployment-runtime-anvil.mjs`:actual Ethereum deployment
  matches complete expected runtime; all9 wrong immutable expectations and a live
  code mutation fail. Disposable bridge fixture; process and tempdir removed.
- `node scripts/test-w02-browser.mjs`:actual built browser recovery, pending
  deployment UI, account lock and encrypted portable restore pass. Maximum two
  concurrent profiles; external requests blocked. Deployment UI uses a fixture
  engine here, not a newly proved live Aztec deployment.
- Offline manifest/report tests:9 pass using actual candidate artifact/class
  preparation and report preflight/write source. Existing output, unrelated report,
  symlink, missing parent, changed destination and wrong result identity reject.
- `node --test scripts/test-operator-launch.mjs`:12 checks pass. Actual shell
  blocks preload sentinels, instrumentation/baggage and executable overrides;
  packaging rejects stale SDK inputs and altered public feed metadata.
- `node scripts/test-operator-package.mjs`:actual isolated package smoke passes
  in9.9seconds;1929 files,255483768bytes, eight runtime dependency packages.
  All four supported routes reach application validation outside repository
  dependencies. Real encrypted recovery preserves claim commitment; wrong
  password and overwrite reject. Temporary package removed.
- Release artifact inventory regenerated successfully after final test edits.

## Criterion mapping and limits

A01:actual CREATE sender/nonce recovery remains covered by deployment journal
checks. The engine only uses the known CREATE2 proxy runtime and verifies all
portal runtime bytes before linking. Real Anvil exercise checks actual compiler
runtime, not a getter-only impostor. Orchestration fixtures cover absent proxy and
recovered actual address; genuine W03 application proofs remain historical scoped
prerequisite evidence, not newly run proofs for this change.

A02/A03:strict independently reviewed intent binds network URLs/chain/version/
rollup/bridges, both deployers, all board economics, censor/policy and exact
artifacts. Preflight runs before proving and again before wiring. Original/current
board class, config hash, policy, censor, bridge references and portal runtime are
checked. Critical reads are bounded and malformed boolean states reject. Owned
providers close even on failure. Tests inject mismatches/unreadable states before
binding/activation; this authenticates agreement with reviewed intent, not an
untrusted RPC's honesty or a current network clearance.

A04:existing encrypted transaction journals remain recovery authority. Pending
Ready settlement cannot produce active UI/report. CLI verifies report destination
before transactions, writes/fsyncs an exclusive temporary and checks destination
identity before atomic replacement. The public report is never a substitute for
journal reconciliation. Manifest is reviewable, not cryptographically signed.

A05:supported shell entrypoint rejects preloads before Node starts, uses packaged
pinned Node and a fresh environment. The signer preserves that profile. Package
closure excludes native Aztec CLI/TXE, ethers5/@ethersproject/elliptic, and binds
current SDK/frontend inputs/resources. Direct developer invocation is outside this
profile. Trusted host/build/operator review remains necessary; this is not a
malicious-administrator defense. The smoke does not prove transactions or start a
model. Public frontend remains a separate static artifact; no developer server or
TXE is included in the operator package.

No audit, target-network approval, moderator quality or final soak gate is waived.
The package remains reproducible from the committed builder; temporary copies are
not retained merely to duplicate244MiB. Final release packaging must refresh its
inventory and rerun supported route checks on that candidate.
