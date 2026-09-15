# Screening-history verification

Pinned Node 24.21.0 and Aztec 5.2.0, repository root. Heavy jobs serialized under existing nine-minute test bounds.

- Contract build passed; only get_screen_hints utility bytecode changed. Posting, withdrawal and fee bytecode/verification keys are unchanged.
- Five targeted history tests pass: 16/17/33 boundaries, multiple deposits and seeded 1002-note tail authentication/exit. The seeded test took 33.1 seconds in the targeted run. It is not 1000 executed/proven publications.
- Full Noir/TXE suite: 150 pass (142 board, eight private fee), including missing/duplicate/stale rejection and unchanged private authentication.
- Actual persisted PXE store: 1100 synthetic records, 11 checks, 341 ms, store reopen and cleanup. This is actual NoteStore/NoteService/pickNotes behavior, not a hand-written filter.
- Rebuilt generated applications and 47 integrated client/artifact checks pass in 0.76 seconds.
- Genuine deposit/post/authenticated-screening journey passes in 274.901 seconds, peak process-tree RSS 1220448 KiB, full owned-process and temporary-directory cleanup. It rejects a tampered chain hint before proving the legitimate next post. Evidence is ../C02/application-a3b4af53-379b-4c51-b7f3-9450d538c07d.json. Official local settlement controls; no network epoch proofs.

The bounded response is two matches per exact successor query, with no hard lifetime-note cutoff. Pinned PXE owner/slot scanning remains linear and is explicitly documented, not represented as constant overall resource use. Internal review and retained build/timestamp-fixture failures are in review.md and numbered logs.
