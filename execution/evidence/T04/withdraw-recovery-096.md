# Accepted withdrawal browser recovery

PASS: application-d84fbac2-0b74-4b49-bdaa-f0019dce8c6c.json, 209997ms, peak2336992KiB. Full process and temporary-directory cleanup. Actual source hashes are in the report.

The node accepted a genuine browser withdrawal before its response was withheld. The test physically closed and reopened the browser on its persistent profile, restored identity without importing journals, recovered the original transaction, then reconnected the disposable Ethereum account to display the pending refund. No second withdrawal or Ethereum refund was submitted.

Independent verification checked canonical inclusion and proof, original consumed deposit note, exact exit leaf, no remaining deposit, unchanged zero post count, one private maximum-fee debit and actual payer fee debit, zero author public fee balance, and outstanding unchanged Ethereum escrow. This qualifies L2 withdrawal recovery, not an Ethereum refund or network settlement.

21 focused control-flow checks and full harness passed before the run. Independent application and structural reviews approved. Component recovery097 separately covers synthetic transaction/storage boundaries; those are not additional genuine proofs.
