# Rolling operations

Open the [operator dashboard](https://d30njln0kead8n.cloudfront.net/_ops/) for
Growth, Reliability and Releases. Team access is invite-only through Cognito,
with a password and authenticator MFA. Each operator has their own login;
operator accounts have no link to anonymous board activity. The dashboard is
read-only. Deployment controls stay in GitHub.

## Verified operations and release

The dashboard and independent monitoring are installed. Slack alert delivery to
`#rolling-chat-updates` was verified on 28 October: an explicit test ALARM arrived,
then real healthy datapoints produced an OK recovery message. This tested alert
and recovery delivery without causing an application outage or restart. See
[`slack.json`](../deploy/launch-ops/slack.json) for the observed messages.

Fresh encrypted off-host backup and actual restore verify **twenty core inputs
and four Bok inputs**. Both daily timers are active; today's automatic runs also
verified restores at 03:15:52 and 03:33:44 UTC on 29 October. See
[`backup-verification.json`](../deploy/launch-ops/backup-verification.json) and the
current release record for the supporting observations.

Candidate J `03bb6b8d`
[passed its full build](https://github.com/zac-williamson/aztec_experiments/actions/runs/40813556181)
and [its actual staged release](https://github.com/zac-williamson/aztec_experiments/actions/runs/40816605889).
All seven flows passed: ETH signup, post, reply, like, reload, Bok credit and
USDC signup. J became live at 04:24:52 UTC; the same source is staged and B48 is
the previous release. Normal pruning removed only the three obsolete releases,
kept J/B48 and their shared dependencies, and enabled the existing hourly timer.
At 04:27:08 UTC, disk usage was 84.63% with 6,220,984,320 bytes free.

The explicit J → B48 → J rollback passed both directions, returning to J at
04:30:54 UTC. Automatic release is enabled. The latest state truthfully says
`rolled-back` with `operator-rollback`; the earlier seven-step promotion record
is preserved separately. This exercised operator rollback without repeating the
funded journey. Automatic rollback after a failed promotion was not exercised.

The scheduled 04:33 UTC observations, read at 04:34 UTC after the rollback,
showed all required services and external checks healthy, all six alarms OK and
no health issues. No probe or alarm override was used. The final receipt is in
[`final-verification.json`](../deploy/launch-ops/final-verification.json);
[`release-acceptance.json`](../deploy/launch-ops/release-acceptance.json) retains
prior failed attempts and the limits of their diagnoses.

The four deliverables are installed and technically verified. The owner still
needs to complete their first dashboard password change and authenticator MFA;
an authenticated owner session has not been verified. The separate application
fast-click defect remains unchanged, and broader production readiness (R04)
is not qualified by this operations work.

## Handover checklist

- **Analytics and private dashboard:** aggregate-only collection with no persistent
  visitor profiles. Complete the owner's first password change and MFA enrollment.
- **Server monitoring and alerts:** server health, external checks and actual
  Slack ALARM/recovery delivery are verified. Assign who responds to alerts.
- **Basic CI and deployment:** full CI, all seven real testnet flows, promotion,
  normal pruning and explicit rollback/return passed for exact J `03bb6b8d`.
  The hourly prune timer is enabled. Keep the accepted source and sealed bytes
  distinct from this later documentation-only handover.
- **Launch safeguards:** public privacy/help/opt-out, existing limits, encrypted
  backups and restore drills are in place. Assign someone to watch public problem
  reports; a confidential reporting address remains an optional operator choice.

Funding balance and provider-spend reporting are not configured; those values
remain unknown. Actual billed incremental charges are also unknown. Review the
$50 incremental budget and 28 November monitoring end date below. Keep this
handover on its separate local documentation branch until the next intended
source release: a docs-only master push would trigger another build and funded
release under the current workflow.

## Anonymous analytics

There are no persistent visitor profiles or visitor identifiers. Analytics
accepts predefined events, coarse attribution and timing buckets, then stores
daily aggregates rather than individual event histories. One-use batch IDs exist
only in a bounded, short-lived deduplication map. No raw IPs, user agents, URLs,
wallet/account addresses, transaction identifiers or post content enter the
analytics database. Collection request-body and access logging must remain off.
Visitors can opt out through Help and privacy; Do Not Track is honoured.

Page sessions are not people: a reload starts a new session. Browser reports can
be missing or falsified and are not financial accounting. Missing or stale
reliability observations must display as unknown. Monitoring must not stop
healthy application services after an observation failure.

## Team access

Use the dedicated user pool in [`identity.json`](../deploy/launch-ops/identity.json).
Administrators invite a user by email and add them to `operators`, or to
`administrators` only if they manage access. Cognito sends the temporary-password
email; the user sets their own password and authenticator at first sign-in.
Do not share passwords or enable public registration. Remove group membership
and disable a departing operator; existing sessions expire within one hour.

Login uses PKCE with state/nonce checks. Operator sessions are held in memory for
at most one hour; secure, HTTP-only cookies are restricted to `/_ops`. Private
APIs require login and are never cached. Production has no development-auth bypass.

## Budget and review date

The total incremental authorization is **$50**. The current planning forecast is
**$25 for the first 31 days**, leaving a $25 buffer. Actual billed launch charges
remain unknown; the separate $1,500/month application-hosting allowance is not
part of this authorization. Reuse the existing hosts and reconcile the project
ledger before expanding resources.

The monitoring schedule ends **28 November 2026 at 11:12 UTC**. Review whether to
renew or retire the dedicated monitoring resources before then; alarms, storage
and KMS can still incur charges after the schedule ends. Keep backup keys until
all retained archives expire. The dashboard's Recorded estimate becomes unknown
after 48 hours unless an operator performs a fresh cost review. It is a planning
estimate, not an automatic billing cap. See
[`spending-estimate.json`](../deploy/launch-ops/spending-estimate.json) and
[`monitoring-reservation.json`](../deploy/launch-ops/monitoring-reservation.json).
