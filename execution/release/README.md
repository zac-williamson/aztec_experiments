# Release outputs

This directory contains engineering provenance, not a cleared production release.
`artifact-manifest.json` is the current local content inventory (introduced in A01, refreshed after W02); regenerate and check it
using BUILDING.md. It binds generated outputs to validated inputs but is neither
a signed attestation nor the final T05 release manifest. Later application changes
require regeneration.

The final package will also contain the manifest and acceptance matrix described
in ../evidence/README.md, plus the following handover documents:

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
