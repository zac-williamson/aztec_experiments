# Independent ten-author contention review

Report: `../C03/application-a8f5dd14-0b63-426f-8389-fa1df3ac5117.json`.
SHA-256: `a3b71ea63bee90df3710c8b7ce2b97ae5ee5c07fb23024b44ddd3e485c10d9ac`.
All 41 recorded source hashes matched current bytes at review time. Review inspected
substantive nested results and corresponding frozen harness source; it did not run
another prover. This is an independent agent check, not the external release audit.

The report supports ten distinct-author contention acceptance within its stated
scope. Preparation checks ten distinct accounts/claims; authorClaims records genuine
claim proofs with exact delivered-note and message-nullifier checks. Contention
records authorCount/preparedCount/submittedCount/includedSuccessCount/verifiedCount
all 10. Every post has a distinct post ID/transaction proof, normal valid node
validation and successful checkpointed inclusion. Public order indices are exactly
0 through 9; exact deposit nullifier, replacement note, post note and public content
checks are true for all ten posts.

All ten transaction anchor headers match canonical block 16, hash
`0x23e97a85c23b91a999dac27310a6c1f4d8ffe9963cef99f3f56f5e63e5891a3d`.
Source verifies header bytes per proof, checks board post count remains zero after
all preparation, and only then enters the submission loop. Thus
allPreparedBeforeSubmission is backed by ordering/assertions, not merely a label.
Inclusion occurs across blocks 17–26, not one block; this tests proofs made against
the same state surviving unrelated-author updates, not single-block capacity.
Individual recorded post proving times range 11858–12346 ms on this host/profile.

Whole-run elapsed time is 459380 ms against 540000 ms; sampled descendant RSS peaks
at 1485616 KiB against 2097152 KiB. Private application proving threads are 2;
node verification and world-state hardware concurrency remain 1, consistent with
the reviewed native profile. Process group and descendant tree absence, wallet stop
and temporary-directory removal are true. RSS is sampled, not an OS allocation cap.

Limits are material: ten independently funded rights, not same-note contention,
reproof/recovery qualification, unbounded concurrency, browser proving, privacy,
throughput or economic finality. Distinct fee payers in this application harness
are not private-fee privacy evidence. Network proving is disabled; controlled
local Ready settlement is explicit. This passing run neither changes the meaning
of earlier failed runs nor closes unrelated compiler diagnostics/audit gates.

Disposition: accept this report as the current bounded ten-author application
contention execution. No concrete gap identified in the stated criterion's
source/result binding; broader claims remain unsupported by this run.
