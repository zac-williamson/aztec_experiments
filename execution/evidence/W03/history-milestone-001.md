# Durable withdrawal search progress

The user engine now supplies an encrypted cursor for each wallet, network, board,
portal and exact withdrawal message. Both CLI and browser use their existing
atomic journal adapters. Completed pages are saved only after rechecking the
canonical anchor. Restart resumes unfinished ranges and includes newly appended
blocks; a changed or shortened chain discards old skipped ranges. Missing pages,
RPC failures and storage failures cannot establish absence.

Verification: history-integrated-001.log records146 passing checks, including
actual engine dispatch, both storage adapters, restart, appended history,
reorg and concurrent cursor updates. history-artifacts-001.log records67 passing
artifact checks. history-browser-001.log exercises the actual rebuilt browser's
existing wallet and transaction recovery journeys; it does not specifically drive
a long-history scan. No new application or network proofs were needed for this
client persistence change. SDK and apps canonical builds passed. Source is bound
to source-history-001.json and artifact-manifest-history-001.json.

Root self-review only: delegated agents remain quota-limited. Cursor results still
rely on the configured node's complete canonical block responses, as did the
previous scanner; this is not a light-client proof. W03 remains active for portable
backups, stale proof replacement, other transaction consumers and stage coverage.
