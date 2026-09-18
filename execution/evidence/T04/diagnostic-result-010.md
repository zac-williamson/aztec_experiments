# GUI claim diagnostic 010

The bounded diagnostic failed after 151182ms, sampled owned-tree peak 1730592KiB;
all recorded cleanup checks passed. See lifecycle-010.json and
application-f04d718d-2b79-465a-8ba2-b660d911b489.json.

Safe UI milestones establish that ETH deposit and claim-secret storage completed,
then claim preparation failed before proving. The unchanged error formatter reported
BB_PRIVATE_FEE_ACTION_FAILED; the mapped source is the generic private-fee action
catch. No raw exception, secret or provider response was retained. The 271-entry
sanitized RPC summary includes one membership call but not its return value: it
does NOT prove that the witness was absent.

Source inspection found independent defects: claim has no bounded Inbox-readiness
preflight; the fixture enables ordinary empty checkpoints only after the claim;
and a confirmed deposit followed by claim failure retains the UI's new-deposit
state. Fix these before a further run. Retain the authenticated event message key,
check membership at the synced wallet anchor before fee/proof preparation, preserve
the receipt and secret on pending/error, and let Retry claim only. Start ordinary
fixture checkpoint production before handoff and restore it on success and cleanup.
No network prover, fee fallback, proof retry loop or resource-limit increase.

This is a failed diagnostic and source-backed repair plan, not lifecycle qualification.
