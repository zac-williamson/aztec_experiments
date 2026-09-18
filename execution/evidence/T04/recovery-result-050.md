# Current browser restart qualification

application-5a39a48b-dc01-4077-874d-1230984c0c0a.json passed in 216,113 ms,
with peak owned RSS 1,698,992 KiB. Owned processes and temporary directory were
removed under unchanged 540-second/2-GiB limits.

The real node accepted the browser-generated post and the test withheld its
response. Full browser closure occurred 114 ms after acceptance (350 ms after
request entry), before ordinary application timeout/reconciliation. The same
persistent profile reopened; identity-only backup restored no journal records.
The actual recovery control recovered the original canonical transaction.

The retained submission hook counted exactly one accepted send. Native verification
checked the original post, exact note/nullifier transition and one private fee debit.
Actual private-credit exhaustion rejected before proof/submission with unchanged
private/public balances and deposit note; forbidden calls were zero.

This qualifies Chromium accepted-post restart on these source hashes. It does not
cover every interruption, browser cold funding, discarded proofs or other engines.
