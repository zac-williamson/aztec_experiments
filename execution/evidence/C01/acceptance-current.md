# Authenticated application bridge acceptance

The user corrected the test architecture: prove application transactions and use
official SDK epoch/Outbox test settlement. Local network proving is not required
for C01. This supersedes the earlier agent-imposed network-proof gate; it does not
weaken application proofs, message authentication/consumption or collateral checks.

`application-c2a64fc6-366e-4460-aad3-dc8424ddf3af.json` passed in264255ms with
peak1643648KiB descendant RSS. No network prover was created. The installed client
prover generated actual board binding, claim and withdrawal proofs; normal node
validation and successful checkpoint inclusion were checked. Official
`settleEpochOutbox`, `markAsProven` and epoch advancement supplied network settlement.
The actual Inbox/Outbox and application portal performed message consumption.

| Criterion | Evidence |
| --- | --- |
| C01-A01 | Actual L1 deposit, claim proof/inclusion, exact amount/nonce/chain, one delivered eight-field note and eleven-field logical view; TXE initial eligibility/bounds controls. |
| C01-A02 | Noir incorrect sender/envelope/depositor/amount/nonce/secret/config and four binding-authority controls; canonical Solidity envelope/constructor tests. |
| C01-A03 | Actual consumed-message replay rejected; actual note burned; actual portal refund cleared active receipt and liabilities; exact portal/depositor balance reconciliation including gas; repeated refund rejected for inactive deposit. |
| C01-A04 | Complete actual application flow passed using official controlled settlement. No protocol proof receipt or Ethereum economic finality is claimed. |
| C01-A05 | Actual eight-physical/eleven-logical note creation, constrained delivery, discovery and nullification; canonical packing/selector/width controls. |

All owned processes and temporary directories were removed. Custom AVM build and
epoch proving cache were subsequently removed; normal installed client-proving
assets remain. Historical failed network experiments remain unchanged as history.

The run source is source-application-harness.json. The final source is
source-application-final.json. Post-run execution-path changes only correct
observation/next-step wording; the obsolete unimported network scheduler now
re-exports the official application fixture. Source-bound review reconciles these
changes; no application contract or client proof constraint changed.

Checks:53 client/artifact tests passed;2 actual process-tree cleanup tests passed.
The consolidated application unit command passed107 Noir tests,29 Solidity
tests and53 client tests (exit0). `application-unit-suite.log` records the complete
run. Earlier103+4 logs remain historical evidence, now superseded by the combined
107-test pass. Portal tests include three known-bad historical
fixtures, which pass by detecting their defects, not by accepting old production
behavior. Controlled-root/TXE fixtures are not network-proof attestations.

C02 screening and later posting/history/economics/wallet/operations work remain
open. This record does not establish production readiness, external audit,
mainnet performance, final release qualification or target-network clearance.
