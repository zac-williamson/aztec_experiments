# Current delegated work

Root integrates shared files, updates graph state, commits/pushes authorized work
and supervises the only expensive test process. Each lane reports observed
results and limitations. AI review is not external audit.

| Lane | Owner | Write ownership | Deliverable |
|---|---|---|---|
| Operations | scheduler_improvements | deploy/operations-monitor.mjs; scripts/test-operations-monitor.mjs; docs/operations.md; execution/evidence/O01/ | Bounded read-only monitor and failure checks |
| Privacy preparation | claim_failure_diagnosis | Read-only | RPC observer seam and fee fallback coverage; claim isolation delivered |
| Integration | root | Graph and policy documents; scripts/test-c01-application.mjs | Review, affected checks, bounded genuine journey, evidence |

Historical assignments remain in history/delegation-before-workflow-revision-2026-09-18.md.
No old agent/process name is evidence of a currently running task.

Workflow43tests and independent review passed. Claim-isolation3tests passed;
root supervises genuine run015 with its source inputs frozen. Operations owns
new disjoint files only. Root prepares the review packet without claiming freeze.
