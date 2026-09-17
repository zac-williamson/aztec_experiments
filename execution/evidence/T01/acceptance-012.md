# Contract and adversarial application qualification

Repository: `/Users/zac/Documents/ChatGPT/Anonymous Message Board/aztec_experiments`.
Pinned Node24.21.0, Aztec5.2.0, Foundry1.4.1, Python3.14.3. Disposable local
identities only. No network epoch prover, public deployment or real funds.

## Executed checks

- `node scripts/test-noir.mjs`:171 passing stateful cases (163Billboard/8private-fee),
  `noir-001.log`. The supervisor enforces540seconds. TXE/constraint execution,
  not171 independently generated cryptographic proofs.
- `FOUNDRY_PROFILE=regression forge test --root billboard/portal --offline
  --fuzz-runs 32 --fuzz-seed 0xc06`:37 passing cases across7suites, including32
  bounded multiuser conservation runs. `solidity-003.log`; isolated test outputs.
- `python3 fv/model-checks/check.py`:482 reachable bridge states/1193edges and
  4593screening states/5384edges; all3bad transition variants yield concrete
  counterexamples. `finite-models-002.json` records bounds, interpreter and hashes.
- `node scripts/check-compiler-diagnostics.mjs execution/evidence/T01/fresh-compiler-007`:
  fresh pinned compilation,57diagnostics/18sites, exact private ACIR correspondence
  for4Board/4PrivateFPC functions. Raw compile and scratch cleanup pass. Explicitly
  accounted for generated names and pinned reverting dispatcher. Not compiler or
  cryptographic soundness assurance; all warning dispositions remain open.
- `node scripts/test-c01-application.mjs --screening`:335408ms,
  sampled peak1377808KiB. Genuine successful posts before/after mutated membership
  probes. Wrong randomness and settled nonce reject in the membership constraint;
  no completed hostile proof is claimed. Exact effects and cleanup verified.
  See screening-review-008 and qualification-notes-011 for reviewed later harness
  deltas; the historical complete source inventory is not the final inventory.
- `node --test scripts/test-c01-native-profile.mjs`:3pass. The contention-only
  two-thread native client profile leaves node/world-state at one and retains
  deadlines/RSS supervision. Independent source review in native-profile-review-012.
- `node scripts/check-artifacts.mjs`:pass, exact current contract provenance.
- `python3 -m unittest discover -s execution/tests -v`:29pass.

`node scripts/test-c01-application.mjs --contention` passed in459380ms, sampled
peak1485616KiB. All ten genuine claims included; all ten post proofs prepared from
one canonical anchor before any submission; all ten posts included, with unique
IDs, execution order, exact deposit nullifiers/replacement notes/post notes/public
content checked. Application threads2, node/world-state1. Owned process/descendant
cleanup and temporary workspace removal pass. Full report:
`../C03/application-a8f5dd14-0b63-426f-8389-fa1df3ac5117.json`.
Review is recorded in contention-review-012.md.
The stopped one-thread attempt010 is retained as timing/failure evidence.

## Assurance boundary

Formal historical Lean/Verity claims are retired, with bodies preserved. Constant
hashes, contradictory assumptions, True claims, obsolete portal state and incomplete
privacy observers cannot qualify this release. The maintained finite executable
models have source identities and mutation controls, not a code equivalence proof.
All26 original compiler observations are preserved; fresh inventory007 supersedes
the earlier coverage001 inventory request. Independent analysis of all57current
occurrences, fee note discovery/privacy, kernel assumptions and actual target
verification keys remains in later qualification/audit tasks.

The test chain includes one transaction per block. Ten-author conflict independence
is not production TPS, finality, private-fee anonymity or browser performance.
Model quality, browser/hosting, public network clearance, independent review and
fourteen-day soak remain separate release requirements.
