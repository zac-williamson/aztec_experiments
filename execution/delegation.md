# Current delegated work

Root integrates shared files, updates graph state, commits/pushes authorized work
and supervises the only expensive test process. Each lane reports observed
results and limitations. AI review is not external audit.

| Lane | Owner | Write ownership | Deliverable |
|---|---|---|---|
| Workflow revision | scheduler_improvements | execution/graph.py; execution/tests/test_graph.py | Bounded concurrent lanes, completion gates, investigation limits and generated status |
| Claim test isolation | claim_failure_diagnosis | scripts/t02-claim-boundary.mjs; scripts/test-t02-claim-boundary.mjs; execution/evidence/T02/claim-boundary-diagnosis-014.md | Actual-SDK cache regression and isolated hostile-witness test |
| Integration | root | Graph and policy documents; scripts/test-c01-application.mjs | Review, affected checks, bounded genuine journey, evidence |

Historical assignments remain in history/delegation-before-workflow-revision-2026-09-18.md.
No old agent/process name is evidence of a currently running task.
