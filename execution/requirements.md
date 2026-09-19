# Production acceptance requirements

These requirements are normative for the execution graph. Existing diagnostic
results are inputs, not completion evidence. P01 expands each requirement into
specific state transitions, observer assumptions and measurable budgets before
dependent implementation. Any scope change must preserve explicit user intent.

| ID | Required behavior | Required release evidence |
|---|---|---|
| REQ01 | One reproducible release uses a supported, compatible compiler, SDK, prover, contracts and target configuration. Generated artifacts match reviewed source. | Clean rebuild, locked dependencies, provenance manifest, artifact-drift failures, live configuration preflight. |
| REQ02 | Posting rights require valid intended collateral; bridge liabilities and withdrawals cannot be forged, replayed or double-claimed. | Wrong-portal/actor/version/amount/secret and replay tests, conservation tests, real-proof bridge round trips. |
| REQ03 | Screening advances only along authentic board notes belonging to the proper owner and deposit chain. | Foreign-contract/owner/slot and old-chain rejection with adversarial Noir tests and actual proofs. |
| REQ04 | Posting and exit remain usable with concurrent authors, long histories and repeated deposits. | At least 10 concurrent authors; capacity beyond 1,000 lifetime history records including multiple deposit cycles, qualified by the recorded C04 layered method (boundary lifecycles, authenticated seeded continuation/exit, actual persisted-store measurements); no fixed history cutoff or starvation; measured workload budgets. Distinguish fixture fee routing and synthetic records from actual proved publications. |
| REQ05 | Cooldowns, penalties, parameter bounds and exits follow an explicit economic model without overflow or penalty reset. | Boundary/fuzz tests and complete flag-screen-withdraw-redeposit scenarios; safe recovery design and documented unavoidable limits. |
| REQ06 | Fees, funding, wallet behavior and product claims meet the documented anonymity model. | Public transaction-footprint analysis, fee-route tests, RPC/host/operator observations, metadata-minimizing configuration, explicit residual limits. |
| REQ07 | Wallet secrets stay private and users can recover interrupted operations without false success or duplicate actions. | Key export/recovery checks, no secret logging, receipt status tests, crash/reload/reorg recovery for each bridge and posting stage including long absence. |
| REQ08 | Moderation treats model output as data, uses authorized signing, tracks work durably and meets a declared policy/window. | Inert argument tests, signer boundary, durable retry/lease tests, versioned policy, evaluated real model, measured deadline and false-positive behavior. |
| REQ09 | Public reading is efficient and wallet-free; supported browsers can complete the product journey with honest error and privacy messages. | Incremental/reorg-safe feed, browser tests, safe rendering, accessible core flows, HTTPS/worker/cross-origin isolation verification. |
| REQ10 | Deployment fails closed; operators can monitor, recover, rotate authority and support private fee recovery and funding outages. No exposed credential is treated as secret. | Rehearsal, runtime/address verification before linking/deposits, credential replacement/restriction, liability/fee/deadline alerts, drills and named owners. |
| REQ11 | One release candidate has meaningful, independently reviewed correctness/privacy evidence and sustained operating evidence. | Nontrivial invariants, real-proof regression suite, independent Aztec/Noir/Solidity audit closure, 14 consecutive days of representative soak and failure drills, final evidence matrix. |
| REQ12 | The requested production target is currently suitable and all deployment inputs are explicit. | Current official network guidance, fresh read-only chain/version/address observations, compatible release manifest, target decision, operator sign-off. |

## Product scope

Deliver source, reproducible builds, generated contracts/client artifacts, user and
operator applications, moderation service, fee route, feed, transaction recovery,
configuration templates, deployment tooling, tests, CI, release manifest and runbooks.
Preserve the original project's attribution and license obligations. Production
keys and provider secrets are provisioned outside source control.

No requirement promises recovery from every lost secret, deletion of immutable
onchain data, or anonymity against arbitrary timing/content correlation. Define
the actual supported guarantees and test them. A configuration that silently leaks
the author's reusable identity does not satisfy an anonymous-board requirement.

## Release policy

- No unresolved critical/high issue, collateral-authentication violation, false
  success path, or violation of the stated anonymity guarantee.
- Lower-severity residual findings require explicit impact, owner, mitigation and
  disposition in the release dossier; they cannot contradict a required invariant.
- A test suite with proofs disabled is supplementary evidence only.
- Network clearance and independent review cannot be satisfied by an agent assertion.
- A release-package completion does not authorize a mainnet transaction.

## Acceptance budgets

P01 records workload, failure/recovery limits, fee/latency budgets and moderation
quality thresholds before observing candidate results. REQ04's workload and REQ11's
14-day minimum cannot be lowered merely to pass. Record hardware, browser versions,
network, model, policy, and workloads. Separate chain/proving latency from app errors.
If an initial target is infeasible, document measurements and obtain a decision on
the affected product promise rather than quietly redefining success.
