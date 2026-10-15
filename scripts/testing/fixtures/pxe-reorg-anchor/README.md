# Pristine V6 RC1 synchronizer fixtures

These two files are byte-identical copies of the installed, pinned
`@aztec-labs/pxe@6.0.0-rc.1` synchronizer before this patch. Their immutable hashes
are `PXE_REORG_ANCHOR_PINS[*].before` in the installer. Tests copy them into isolated
temporary packages before applying the exact transform; the installed dependency
may be original or already patched, but is only inspected, never changed.

The native regression uses the actual installed L2BlockStream, L2TipsKVStore,
LMDB, NoteStore, AnchorBlockStore and StagedWriteCoordinator. Synthetic headers,
node responses, and directly inserted NoteDao fixtures are labelled in the test.
They establish conservative rollback/atomicity and canonical anchor delivery,
not real encrypted-note discovery, FPC balances, or historical incident cause.
