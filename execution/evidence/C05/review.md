# C05 engineering review

Root integrated disjoint contract, economics, test and consumer lanes. This is
agent-assisted self-review, not the independent release audit.

The contract now uses the specified M-1 save-up floor and checked eligibility
addition. Real screening authenticates existence, publication time and deadline
against the same anchor; public flags stop strictly at the deadline. Public
inclusion captures the policy content hash and emits V1 events. Withdrawal still
requires both completed real-post screening and expired debt.

Private real-post admission reserves a possible timely recovery schedule within
the executable timestamp domain, using the pinned protocol transaction lifetime,
remaining screening transitions, maximum per-step debt and final withdrawal.
Sequence capacity is also reserved. This does not promise recovery after arbitrary
inactivity or protocol outages. No private backlog count is published. A reviewer
noted dummy transitions do not independently recheck the sequence reserve; an
exhaustion path is not demonstrated reachable under positive cooldown, bounded
save-up and the much smaller executable time domain. Final audit retains this
boundary for independent review.

Consumer review found and fixed a policy-read race: independent current-version
and current-content queries could disagree across a policy update. The CLI now
uses one atomic contract snapshot. The moderator binds its reviewed version to
its signing request. Review also fixed browser withdrawal status that previously
ignored outstanding debt and updated both feeds to resolve stable post identities.

Historical policy content retrieval remains M02 work. The daemon now fails closed
for unmatched historical-policy posts before asking the model or signer, and
continues processing matching current-policy posts. It does not silently classify
those historical posts as complete. No local/default policy may replace the
contract policy for signing.

Dependency review: adding a direct sha256 v0.3.0 declaration uses the already
locked transitive package. All dependency package trees are unchanged. The two
additional embedded source files are the already locked Aztec event macros and
event emission implementation. Only the reviewed local manifest and exact embedded
source inventory were updated; no dependency checksum was relaxed.

Coverage distinction: flagged debt/exit/redeposit is exercised by actual TXE
application calls with test-controlled bridge messages. The genuine local L1
bridge/refund journey from W01/C01 is separate; it must not be described as an
integrated flagged L1 cycle. C05 additionally requalifies genuine screening and
private fee composition against its new contract artifacts.
