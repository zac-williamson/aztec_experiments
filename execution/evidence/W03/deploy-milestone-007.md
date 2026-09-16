# Resumable board deployment

The deploy engine saves Aztec deployment/binding transactions before submission,
reconciles the exact canonical request on restart and recovers the binding hash
from authenticated operation metadata. It no longer treats matching error text as
successful deployment. Missing or unresolved journals fail closed. Its PXE closes
on every exit.

Ethereum creation/activation extend the existing journal with a deployment profile.
It validates creation bytecode hash, CREATE2 salt/proxy or direct sender-derived
address, exact sender nonce/value/data and canonical receipt. Activation requires
the matching configuration event. The creation nonce floors the activation nonce
across separate records when provider data is stale. Explicit retries retain the
original nonce; successful recovery does not send again. The engine verifies the
portal configuration before binding it.

Settlement is one bounded check, with exact Ready transaction identity, canonical
finalized block and a witness followed by another receipt check. Unavailable
settlement returns a pending state without enabling deposits or a ready-to-use UI
link. An RPC timeout remains unknown. Browser setup uses the shared wallet/context
lock. No network prover or 15-minute polling loop is used.

Evidence:
- deploy-integrated-006.log:204 passing checks, including actual engine + encrypted
  journal restart tests and malformed deployment request/event/nonce cases.
- deploy-ethereum-anvil-002.log:real local contract creation and activation both
  recover after their responses are lost after mining, with no duplicate signing;
  existing real escrow and fee bridge checks also pass. Fresh test identities,
  controlled application settlement roots, owned process/data cleanup confirmed.
- deploy-browser-006.log:actual built browser, four fresh profiles, deployment
  pending display and lock enforced; encrypted wallet/journal recovery regression.
  Two external requests were blocked. Deployment chain/prover calls in this UI
  check are inert; it is not an end-to-end production deployment.
- deploy-artifacts-006.log:143 artifact/provenance/client checks.
- deploy-sdk-006.log and deploy-apps-006.log:builds pass.

The complete-engine tests use controlled SDK/chain fixtures; this milestone does
not claim a fresh genuine Aztec deployment proof. Existing real proof evidence
remains historical. Root inspected journal ordering, nonce separation, exact-hash
reconciliation, pending UI and cleanup separately from implementation; self-review
only, no independent signoff. W03 remains active for stale-proof replacement and
full-stage qualification.

Binding: source-deploy-007.json (fingerprint
7b7ddaa80d7e68b61e2d4cc3915912b4a3f0e9d624d88b3d067958fc473165cb),
artifact-manifest-deploy-007.json and recovery-runbook-deploy-007.md.
