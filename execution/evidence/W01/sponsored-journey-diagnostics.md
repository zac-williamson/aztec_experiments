# Genuine journey diagnostics

Run001 (application-c9beff0b-cd79-4235-8cc4-d7f0d6276300.json) stopped after115999ms: sponsor deployment was genuinely proven and included but publicly reverted. Cleanup passed. No sponsored author transaction succeeded.

Run002 (application-2a7e2fdb-3a88-40c4-8bec-5e44cc8ef0ee.json) stopped after106131ms. Added exact public simulation before send and recorded public constructor configuration. It exposes max_fee_da=0, violating sponsor validate_config's positive unit-fee-cap requirement. The local SDK default DA price is zero; multiplying it preserved zero. This is a new test-configuration defect, not a demonstrated production contract vulnerability.

Correction: local harness chooses max(16*quoted price,1) in each dimension, retaining all contract cap checks. No deadline/resource/proof-check changes. Actual public simulation remains before admin submission to avoid knowingly paying for a public revert. Run003 follows; no result presumed.
