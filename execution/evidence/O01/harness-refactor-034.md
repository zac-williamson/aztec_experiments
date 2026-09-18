# Harness simplification — implementation checkpoint

User-directed refactor, 2026-09-18. Prior integrated run032 failed without retaining the command result. Source review established that nested process cleanup could mask the result; it did not establish the original exception. No success claim is made for that run.

Changes prepared:

- Replaced the implicit default and 21 cascading CLI modes with 16 explicit named scenarios. Fixture choice, author count, fee source and browser role are declared, not inferred from environment flag combinations.
- One application/UI process supervisor records command exits and cleanup results separately. A command runner no longer owns a second process-tree cleanup. Removed bespoke browser failure classification/supervision.
- Split executable entrypoint, fixture worker, browser worker, source/asset verification and scenario action sequences. Existing proof/state assertions remain in action helpers.
- Removed retired AVM build, server-proof, old network deployment and ACVM adapter code and its unused tests. Historical evidence remains unchanged and Git retains the source history.
- Removed snapshot retries, runtime CRS source/representation fallback, build CDN fallback and secondary setup cache precedence. Missing/corrupt required runtime data fails directly. Builds provision only absent output from the single pinned source.
- Application deployment requires its primary pinned CREATE2 proxy before wallet/proving work; no alternate CREATE path. Deleted unused legacy deployment/address-decoding helpers.
- Added an explicit hierarchy: harness contracts and tiny process tests; application component/contract tests; actual offline/package integration; fixture startup/inclusion/activation; complete journeys.

Validation is pending at this checkpoint. The new harness cannot inherit historical browser/proof qualification. On its first unexpected validation failure, execution stops and findings are reported, without retries or workarounds.

## Validation so far

- Initial harness tier: 44 checks, all passed; total reported file-test durations 4.69 seconds.
- Component tier: 180 checks, all passed; total reported durations 2.31 seconds.
- Subsequently removed the GUI claim retry loop entirely; actual driver error-path regression passes in no-claim-retry-034.log. The driver now performs one action and reports any error without clicking again. No receipt-delay workaround was introduced.
- Node-only fixture: 7707ms, sampled peak609152KiB, complete owned cleanup.
- Included board: 44695ms, peak1099568KiB, genuine deployment proof/inclusion and complete cleanup.
- Activated board: 83920ms, peak1000192KiB, actual Ready message/local controlled activation and complete cleanup.
- Rebuilt SDK and applications; actual offline CLI initialization passed887ms, zero remote requests.

The complete private-fee journey is being validated separately. These results do not qualify every browser, workload, recovery stage or operational command.

## Stop condition

Graph render rejected duplicate ownership of shared/helpers.js in active O01 and T03. Root stopped the in-progress private-fee journey with SIGINT, verified the supervisor recorded owned cleanup, and did not repair or retry. This is an execution-plan validation error, not an Aztec application failure. Refactor qualification is incomplete. See harness-stop-034.json.
