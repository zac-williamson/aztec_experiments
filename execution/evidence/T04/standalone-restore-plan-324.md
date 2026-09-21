# Standalone restoration drill — prepared, not executed

The existing offline drill authenticated a downloaded state backup with helpers
from the development checkout. This next check must demonstrate recovery using
only the matching saved operator package. AWS authentication expired before any
new remote action; this is a plan, not recovery evidence.

1. Retain and download the exact executable package, separately from state. The
   current state backup stores an inventory, not the executable files themselves.
   Verify every package file against its inventory and the recorded inventory hash.
2. Use a backup with the same inventory. Backup296 belongs to the earlier package;
   pair it with that exact package, or create a fresh quiesced backup of the current
   package. Do not present a mixed-version restoration as an exact recovery.
3. Extract into a separate private directory. Verify the downloaded archive hash,
   the state file manifest and SQLite integrity. Never overwrite live state.
4. In a network-disabled process, use the restored pinned Node executable and
   restored dependencies to authenticate the saved journals and restore the private
   checkpoint into fresh in-memory IndexedDB. Do not start the daemon or signer.
5. Check that the recorded service paths and model manifest match retained artifacts.
   Record cleanup and the exact inputs; never print wallet or journal contents.

The packaged runtime includes fake-indexeddb, the PXE cache adapter and file journal
storage adapter. It does not contain standalone shared/sdk-store.mjs or
shared/journal-backup.mjs. Their getPXEStoreIdentity and createJournalBackup exports
are in the verified SDK bundle. Anchor dependency resolution to the restored
scripts/operator-launch.mjs; a root package.json is not part of the distribution.
Use the existing CLI bundle-loading method without starting CRS, PXE or network
clients. Check these entries in the actual downloaded inventory before execution.

Current package: operator-json-20260921. Recorded inventory SHA256:
62534006fea6ff00d70a9c21d61993eeee57ec61426f070989c24396bf0bee54.
The current inventory has not yet been downloaded for this check.

Independent read-only review: aws_stack_review checked the packaging code and two
retained older inventories. Root remains responsible for execution and evidence.
This drill needs no new instance or new signing. It does not establish clean-host
provisioning, IAM/SSM recovery, model installation, or live reconciliation after
loss of the original machine. Those remain replacement-host recovery work.
