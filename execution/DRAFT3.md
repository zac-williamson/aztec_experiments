# Rolling Chat Draft 3 execution

Source: Rolling Chat Contractor Specification Draft3, all11pages, SHA256 in draft3-requirements.json. This file and requirement map are new supplemental engineering records, not claims of application acceptance. The existing ignored local execution/graph.json and historical evidence remain the execution ledger; do not force-add132MB of earlier private working evidence.

Run `python3 execution/graph.py validate`, `python3 execution/specification_check.py`, then `python3 execution/graph.py next` in the established workspace. Every new G01–G14 task has declared paths, owner, branch, dependencies, item-level criteria, evidence paths and verification method in that graph. planned=ready only when dependencies pass; active=running; verification=checks; review=independent review; done=verified and integrated. Changes requested remain active/review with concrete findings. blocked requires evidence and recovery condition.

Integration uses execution/integration_gate.py with a lead-owned hashed policy and exact candidate/base review/check/evidence records. A work commit is not an integrated candidate. See INTEGRATION.md. Registry uses actual runtime handles and retains concise handoffs; raw runtime histories stay in host storage.

Standing authority follows the11October user mandate and specification-clarifications.md. Baseline master458724c is historical. Existing audit/network/14-day-soak gates remain mandatory, and development acceptance never implies production qualification.
