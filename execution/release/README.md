# Release outputs

This directory is intentionally not a release candidate at setup. During execution
it will contain the verified manifest and acceptance matrix described in
../evidence/README.md, plus the following handover documents:

- Release identity, source revision/fingerprint, reproducible build instructions.
- Deployable artifacts and their provenance (or verified local artifact references).
- Network compatibility and security clearance, with observation dates.
- Requirement coverage and all B01–B12 dispositions; new findings and residual risks.
- Independent review, remediation and final closure references.
- Real-proof integration, privacy, browser/load/recovery and 14-day soak evidence.
- Environment/configuration templates without secrets.
- Deployment rehearsal, fail-closed checks and operator runbooks.
- Named ownership, moderation policy, fee limits, incident and recovery procedures.
- An explicit statement of whether actual production deployment has been authorized
  and performed. A ready package is not evidence of a live deployment.

No release checklist may be marked complete from planning documents or source
inspection alone. R04 and graph.py enforce the prerequisite/evidence structure;
independent reviewers and operators assess the substantive evidence.
