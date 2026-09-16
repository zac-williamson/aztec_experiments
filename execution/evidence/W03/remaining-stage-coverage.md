# W03 final stage coverage

All transaction consumers now use durable, authenticated identity and explicit
canonical outcomes. Current integrated checks:468 passing, zero failures.

| Stage | Qualification |
|---|---|
| L1 collateral deposit/refund | Real Anvil mined-response loss, exact nonce/event recovery, repeat recovery without resending |
| Private fee approval/deposit | Real pinned token/Inbox/portal recovery, no duplicate payment |
| Author claims | Exact receipt/message/custody-bound recovery; changed identity and unknown outcomes rejected |
| Real posts | Genuine invalid old proof, journal restore and same-post replacement inclusion; current engine/journal regression |
| Screening/withdrawal | Genuine same-note proof attribution and stale rejection; source sequence/final nullifier preservation and replacement races tested in client fixtures |
| Private fee claim | Saved beneficiary/funding record restored; canonical funding revalidation; edited UI intent ignored |
| Moderator actions | Saved method/arguments restored; authority rechecked; differing daemon jobs blocked; canonical revert never success |
| Deployment/binding | Predicted board and original portal preserved; conflicting state blocked; real Ethereum creation/activation recovery |
| Withdrawal history |1100-block fixture,22 bounded pages, encrypted restart cursor, reorg reconciliation, no unstored hash required |
| Browser/CLI custody | Actual built browser reload and portable restore; encrypted file journal, atomic writes, process death and lock checks |

The genuine runs are historical source-bound reports; final source reconciliation
remains T05. Engine RPC fixtures are not real chain/proof evidence. The real
screening/withdrawal run qualifies attribution and rejection, not a live combined
regenerated-screening race. M02 owns durable moderation queue operations. No
external audit, network clearance or elapsed soak is claimed here.
