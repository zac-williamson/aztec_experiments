# Decisions and defaults

Recorded 2026-09-11 during setup. These are explicit engineering defaults derived
from the requested productionization, not claims that the user approved each
commercial or policy decision. P01 validates them and records material changes.

| ID | Engineering default | Decision boundary |
|---|---|---|
| D01 | Preserve ETH escrow and centrally administered moderation. | A new admission mechanism or trust model needs a concrete proposal and user decision. |
| D02 | Preserve meaningful flag penalties across withdrawal/redeposit; keep a usable exit. | P01 defines exact economics; if implementation requires a material custody/trust change, escalate that choice before dependent changes. |
| D03 | Shared sponsored or supported private fees; no reusable public user fee-payer identity. | W01 compares supported mechanisms locally. Production sponsor budget and owner must be supplied before operating it. |
| D04 | Describe anonymity against chain observers with explicit limits for content, timing, RPC and host observations. Minimize metadata and default telemetry. | Do not promise network anonymity or hide a new identity-bearing relay behind a privacy claim. |
| D05 | Keep public immutable content and existing onchain flag semantics initially. Provide clear policy and human review/support workflow; UI hiding is reversible. | Reversing an onchain penalty/flag or introducing an appeal authority is a product and protocol change requiring a decision. |
| D06 | Support current stable desktop Chrome, Firefox and Safari at the time of release testing. Public feed works without loading a private wallet. | Measure proving support first. Unsupported posting environments must be detected and explained; removing a promised browser requires a decision. Mobile read access is in scope; mobile proving is measured and explicitly disclosed, not silently promised. |
| D07 | Local development and test-only deployments use fresh disposable identities. | No existing user wallet, real funds, purchases, reviewer outreach or live production deployment without explicit authority. |
| D08 | Deliver a deployable release package and runbooks, then obtain authorization for actual production deployment. | “Production ready” cannot mean “already deployed,” and cannot be declared while required release evidence is missing. |
| D09 | Requested target remains Aztec V5 mainnet; verify current official guidance and exact version compatibility. | If the target is unsuitable, continue compatible local work and present the migration delta; do not silently substitute V6 or waive the network gate. |
| D10 | No unilateral administrator sweep or timeout refund that leaves valid L2 claims. | C06 designs recovery only where it preserves liabilities and invalidates/reconciles claims. Irrecoverable lost-key cases are documented honestly. |
| D11 | Independent Aztec/Noir and Solidity review, real-proof end-to-end validation, and 14 consecutive days of representative soak are mandatory. | A second AI pass or mocked test does not substitute. No automatic waiver. |

## Material inputs to collect without blocking independent engineering

- Named production owner, moderation operator and incident contact.
- Sponsorship spending limit and funding/replenishment authority.
- Final moderation policy and response/appeal process.
- Independent reviewer access/engagement (prepare the package before requesting it).
- Production infrastructure accounts and budget; replace/restrict previously exposed credentials.
- Target-network decision if V5 cannot meet the network release requirement.

Each new entry records: date, task ID, choice, alternatives, evidence, impact on
requirements and acceptance tests, and whether user input is required or received.
Do not reinterpret elapsed time or a missing reply as approval.

## 2026-09-11 — P02 discovery: baseline version versus production compatibility

The reproducible foundation preserves upstream 5.0.0 to establish trustworthy
baseline builds and tests. Current official guidance requires 5.1.0 changes for
contract developers and describes 5.2.0 as compatible maintenance. P04 now owns
the explicit supported-V5 upgrade and reruns before interface freeze. This remains
within the requested V5 target; a V6 retarget would require a separate assessment
and user decision. The live incident notice leaves X03 blocked for release while
internal engineering continues. Sources and exact unknowns are recorded in
`evidence/P02/current-network-inputs.md`.
