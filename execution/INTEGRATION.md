# Development integration gate

`integration_gate.py` uses Python 3.9+ and Git. The lead owns policy, assignments,
and integration; workers supply candidate commits and observed evidence. This is
a small local gate, not a replacement for remote branch protections, external
specialist review, production qualification, or the execution graph. Existing
graph states map `active` to running and `done` to integrated only after acceptance.

## Candidate procedure

1. Reconcile the graph, actual worker liveness, holds, current branch tip and
   ownership with the durable session registry. Do not reclaim a live writer.
2. Build a candidate branch descended from the current integration tip. For
   multiple contributions, combine them on that candidate first. Keep unrelated
   user changes in their existing checkout. Test the combined candidate and send
   its exact commit, requirements and acceptance criteria to a different reviewer.
3. Freeze a lead-owned policy snapshot using the schema below. Required checks,
   affected requirements and scope come from the task/requirements ledger, not
   the worker's claim of what passed. Include all active ownership claims and
   applicable holds. Confirm remote automation before choosing the integration
   ref. A development integration must not trigger an unauthorized release.
4. Save exact-revision checks, independent review and requirement acceptance in
   the evidence record. Logs/reports use the existing `execution/evidence/`
   layout. Preserve failed results separately. Do not commit new evidence into
   the frozen candidate: that creates a different revision. Evidence can remain
   beside the candidate and be committed in a subsequent documentation candidate.
5. Run the trusted lead's gate in `check` mode. Then run `integrate` with the same
   inputs. The second command repeats validation and atomically compares the
   old branch tip before advancing it. A moved base requires a new combined
   candidate and renewed checks/review. Never repair that error with a force reset.

The integration ref must not be checked out in any worktree. In a dedicated,
clean integration checkout only, detach HEAD at the current tip before using
the gate and check out the integration branch afterwards. Never detach or switch
someone else's dirty checkout. A new non-checked-out development integration
branch is also suitable. No shared ref should be advanced by cherry-pick/merge
before the gate; form those commits on the candidate branch instead.

```sh
python3 execution/integration_gate.py check --repo . \
  --policy /absolute/path/to/lead-policy.json \
  --policy-sha256 ACTUAL_LEAD_APPROVED_SHA256 \
  --evidence /absolute/path/to/evidence.json \
  --evidence-root /absolute/path/to/repository/execution
python3 execution/integration_gate.py integrate --repo . \
  --policy /absolute/path/to/lead-policy.json \
  --policy-sha256 ACTUAL_LEAD_APPROVED_SHA256 \
  --evidence /absolute/path/to/evidence.json \
  --evidence-root /absolute/path/to/repository/execution
```

The digest is SHA-256 of the policy bytes, approved by the lead after inspecting
them. Use a gate script from a revision the lead has reviewed; do not execute an
unreviewed candidate's replacement gate to approve that candidate. Record the
policy digest, gate revision, result JSON and integration mapping in the existing
ledger. Pass exact full commit IDs, never mutable branch names for source/base.

## Lead-owned policy schema

Example values are placeholders, not acceptance evidence. Paths are repository
relative exact files or directory prefixes, without globs or trailing slashes.
Each required list is nonempty except holds. Ownership includes this task's
claim plus other active claims; overlapping scopes across tasks or owners fail.

```json
{
  "task_id": "G01",
  "implementer": "actual-implementer-session-id",
  "candidate": "FULL_CANDIDATE_COMMIT_ID",
  "base": "FULL_CURRENT_INTEGRATION_COMMIT_ID",
  "integration_ref": "refs/heads/codex/rolling-integration",
  "allowed_paths": ["execution/integration_gate.py", "execution/tests/test_integration_gate.py", "execution/INTEGRATION.md"],
  "required_checks": ["integration-gate-tests"],
  "requirements": ["REQ11"],
  "holds": [],
  "ownership": [{
    "task_id": "G01",
    "owner": "actual-implementer-session-id",
    "paths": ["execution/integration_gate.py", "execution/tests/test_integration_gate.py", "execution/INTEGRATION.md"]
  }]
}
```

## Evidence schema

Every check, review and acceptance record repeats both candidate and base IDs.
Artifacts are relative to `--evidence-root`, cannot escape it, and require matching
SHA-256 bytes. Include actual commands/procedures, environment, expected/observed
behavior, limitations and source identity in reports. Reviews document failure
scenarios, severity, assumptions, checks performed and disposition. Use stable
runtime session IDs for implementer and reviewer. A different display name does
not prove independence; the lead verifies it against the registry.

```json
{
  "task_id": "G01",
  "candidate": "FULL_CANDIDATE_COMMIT_ID",
  "base": "FULL_CURRENT_INTEGRATION_COMMIT_ID",
  "holds": [],
  "findings": [],
  "checks": [{
    "id": "integration-gate-tests",
    "candidate": "FULL_CANDIDATE_COMMIT_ID",
    "base": "FULL_CURRENT_INTEGRATION_COMMIT_ID",
    "status": "pass",
    "exit_code": 0,
    "command": "python3 -m unittest discover -s execution/tests -p test_integration_gate.py -v",
    "environment": "actual OS/Python/Git versions and isolated checkout",
    "observed": "actual outcome",
    "artifacts": [{"path": "evidence/G01/check.log", "sha256": "ACTUAL_SHA256"}]
  }],
  "review": {
    "candidate": "FULL_CANDIDATE_COMMIT_ID",
    "base": "FULL_CURRENT_INTEGRATION_COMMIT_ID",
    "kind": "independent",
    "reviewer": "actual-other-reviewer-session-id",
    "implementer": "actual-implementer-session-id",
    "verdict": "approve",
    "artifacts": [{"path": "evidence/G01/review.md", "sha256": "ACTUAL_SHA256"}]
  },
  "acceptance": [{
    "id": "REQ11",
    "candidate": "FULL_CANDIDATE_COMMIT_ID",
    "base": "FULL_CURRENT_INTEGRATION_COMMIT_ID",
    "status": "pass",
    "artifacts": [{"path": "evidence/G01/acceptance.md", "sha256": "ACTUAL_SHA256"}]
  }]
}
```

Findings, when present, have `blocking: true|false` and `status: open|resolved`.
Unresolved blocking findings fail. Missing fields are not a waiver. Checks with
`fail`, `pending`, `skipped`, `unreadable` or missing statuses fail with their
distinct status in the result; absent required checks and unreadable artifacts
have distinct diagnostics. Exit status must also be zero. Stale evidence, missing
acceptance/review, artifact changes, scope violations and ownership conflicts fail.

## Verification and limits

```sh
python3 -m unittest discover -s execution/tests -p test_integration_gate.py -v
```

The suite uses disposable Git repositories, runs a deliberate failing assertion,
verifies that it and missing review prevent ref advancement, then verifies the
passing control and an expected-old-ref race. It changes no application code or
services and leaves no deliberate defect. Its fixture reports are explicitly
synthetic and do not qualify any product requirement.

The gate validates evidence structure, bytes, scope and revision binding; it
cannot establish the truth of claimed test results, identify forged session IDs,
or replace independent technical review. The lead must inspect real evidence and
keep policy authoritative. Policy/ownership snapshots are not live locks: serialize
shared ownership changes with integration and reissue the snapshot if they change.
Atomic Git ref update prevents a lost update; the lead still owns the single-writer
lease and recovery procedure. A user able to call Git directly can bypass this
local gate; keep remote required checks/protections intact and restrict who pushes.
Git `update-ref` does not run merge hooks or push/remotely deploy anything. A local
watcher may observe ref changes, so automation inspection remains required.

This control does not supply unattended recovery, specialist audit, network
clearance or elapsed soak evidence. Those retain their existing tasks and gates.
