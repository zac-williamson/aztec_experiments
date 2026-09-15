# Actual PXE history selection check

`node scripts/test-screening-history-pxe.mjs` passed on pinned Aztec 5.2.0 in 341ms (under one second including process startup). Output: `pxe-history-003.log`.

The fixture writes 1,100 synthetic historical NoteDaos and targeted successors to the actual native LMDB NoteStore. It uses the installed NoteService and pickNotes implementations used by the PXE utility oracle. It verifies the desired successor lies outside the former first-1,000-note window, then verifies both equality selectors apply before limit 2. It also checks independent deposits, owner/slot/contract isolation, reversed insertion, missing matches, actual store close/reopen, scope deduplication, duplicate successor detection, and pagination after selectors.

These are synthetic stored notes, not 1,100 proven transactions or valid committed note hashes. The test verifies storage/query behavior; the Noir lifecycle tests and real application journeys cover contract execution and proofs separately. The PostNote layout uses full fields at indexes 1 and 5; separate Noir tests assert the generated property metadata.

The store uses a 16MiB maximum map and is removed in finally. A post-run check found no remaining test directories. Attempts 001 and 002 failed before opening storage because the fixture initially used unexported address constructors; the final fixture uses pinned `AztecAddress.fromFieldUnsafe` for synthetic addresses. The empty temporary directory from attempt 001 was removed.

Source inspection: installed `NoteStore.getNotes` filters scope, owner, storage slot and status, then sorts by block/transaction/note position, without a record cap. `NoteService.getNotes` maps those records. `pickNotes` applies selectors, then sort, then offset/limit. This ordering is why exact successor selectors remove the former cap without fetching 1,000 notes into Noir.
