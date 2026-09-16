# Remaining transaction consumers — AI review

Read-only review of stale private-fee claim, deployment/binding and moderator
recovery changes and their focused tests. This reviewer made no application
changes during this review and ran no heavy jobs. This is AI review, not an
independent audit. Root reports 99 consumer checks passing; that count was not
independently rerun by this reviewer.

## Disposition

No blocker found in the reviewed consumer changes.

- Private-fee recovery first reconciles the saved exact transaction. Only a
  recovery-required outcome followed by the journal's fresh definitive-invalid
  checks permits replacement. The saved owner and exact original funding record
  are restored, rather than replacing intent with the currently selected UI
  deposit. Canonical funding validation is bounded and the reconstructed
  operation must match before proving. No deposit or approval is repeated.
- Deployment recovery retains the predicted board's constructor/configuration
  identity and saved binding portal. Existing or conflicting L2 state is not
  guessed to be completion. A missing saved portal cannot cause new Ethereum
  creation. Its configuration is checked before binding. The previously noted
  missing regression for an already-present board after stale deployment is
  now reported covered by root.
- Moderator recovery decodes the saved method and arguments, then requires the
  reconstructed operation string to match exactly before fee preparation.
  Current authority is checked on stale recovery. Existing policy/post checks
  remain in force. The daemon's reconciliation route refuses to replace a
  different current job with the saved operation.
- Previously successful canonical moderator operations remain separate from
  reverted or unresolved outcomes. Generic recovery returns reverted status
  explicitly rather than marking the job successful. Unknown/live attempts do
  not gain replacement authorization merely from their operation metadata.

The moderator decoder's policy length bounds match the contract's nonempty
1–1488-byte policy constraint. Reconstruction is followed by exact operation
comparison, so lossy text decoding cannot silently alter the saved request.

This review covers integration logic and focused regression coverage. It does
not claim genuine proof qualification for each stale consumer, external
security review, elapsed soak coverage or whole-application production readiness.
