# Rolling operations

The 28 October scope is first-party aggregate analytics, a private Growth / Reliability / Releases dashboard, independent monitoring and Slack alerts, gated testnet releases, and minimal recovery/abuse controls. No application visitor profiles or persistent visitor identifiers. Operator login accounts are separate and have no link to board activity.

Design: retain Rolling's self-hosted DM Sans, violet #5b4df0, ink #17223b, pale ground #f6f7fb, white #ffffff and lines #e5e8f0. Use a narrow left navigation, one page title and a compact metric strip above useful tables. Align labels and values consistently. Status colours convey measured state only. No illustrative data, inferred healthy state, decorative motion or external fonts.

The dashboard uses invite-only Cognito password + authenticator access. Its public client has no client secret, code flow uses PKCE and state/nonce checks, and operator sessions are held in memory for at most one hour. Cookies are secure, HTTP-only and restricted to /_ops. Public visitors send no operator identity. Production has no development-auth bypass.

Analytics accepts predefined events, coarse attribution and timing buckets. It retains daily aggregates, not individual event histories. One-use batch identifiers remain only in a bounded short-lived deduplication map. No raw IPs, user agents, URLs, wallet/account addresses, transaction identifiers or post content enter the analytics database. Reverse-proxy, CDN and collector request-body logging must remain disabled for collection. Page sessions are not people; a reload starts a new session. Browser reports can be missing or falsified and are not financial accounting.

Deployment controls remain in GitHub; the dashboard is read-only. A public health check reports only availability and software revision. Private APIs require operator login and are never cached. Monitoring must treat missing/stale observations as unknown. Runtime failures must not stop healthy application services.

Budget: USD50 total incremental authorization for this work. Reuse existing application hosts; do not provision another EC2 server. The project ledger reserves USD25 and USD25 buffer for initial operation. This is not a new recurring monthly allowance. Existing USD1500/month hosting is separate. Track new resources and observed charges before any expansion.

Invitations: use the dedicated user pool recorded in deploy/launch-ops/identity.json. Administrators create an invited user with their email and add them to operators (or administrators only if they manage access). Cognito sends the temporary-password email. Users set their own password and authenticator at first sign-in. Remove group membership and disable a departing operator; existing short-lived sessions expire within one hour. Do not share passwords or add public self-registration.

Remaining acceptance is recorded in execution/graph.json. A configured workflow is not evidence that a real-proof journey, Slack delivery, recovery or rollback has passed; each needs an actual observed result before completion.
