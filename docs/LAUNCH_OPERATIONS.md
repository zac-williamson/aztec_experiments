# Rolling operations

Open the [operator dashboard](https://d30njln0kead8n.cloudfront.net/_ops/) for
Growth, Reliability and Releases. Team access is invite-only through Cognito,
with a password and authenticator MFA. Each operator has their own login;
operator accounts have no link to anonymous board activity. The dashboard is
read-only. Deployment controls stay in GitHub.

## What is verified, and what is pending

The dashboard and independent monitoring are installed. Slack alert delivery to
`#rolling-chat-updates` was verified on 28 October: an explicit test ALARM arrived,
then real healthy datapoints produced an OK recovery message. This tested alert
and recovery delivery without causing an application outage or restart. See
[`slack.json`](../deploy/launch-ops/slack.json) for the observed messages.

Fresh encrypted off-host backup and actual restore passed on both hosts on
28 October: **twenty core inputs and four Bok inputs**. Both daily timers are
active. See [`backup-verification.json`](../deploy/launch-ops/backup-verification.json)
for the observed results. Candidate `aad8c265`
[passed its full build](https://github.com/zac-williamson/aztec_experiments/actions/runs/40775154163)
on 28 October. Its real staged release then passed ETH signup, posting, reply,
like and reload, but stopped at Bok credit before USDC signup or promotion.
Baseline `48c2750f` remains live, and automatic release was disabled after the
failed attempt.

A local reproduction with the actual account panel confirmed a missing funding
wallet reconnection in the journey harness after reload. The next repaired
candidate still needs its own exact full build and complete genuine journey.
Promotion, normal release pruning and the two-leg operator rollback exercise
remain **pending final receipts**. The five completed steps do not establish
full release acceptance. A subsequent read-only check also found insufficient
USDC/FEE test liquidity; it needs repair and a fresh quote before another journey.
See [`release-acceptance.json`](../deploy/launch-ops/release-acceptance.json) and
[backup acceptance and procedure](../ops/LAUNCH-ESSENTIALS.md).

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
