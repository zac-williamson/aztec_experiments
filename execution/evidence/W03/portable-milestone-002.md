# Portable transaction recovery

Password-encrypted browser recovery files now include scoped Aztec/Ethereum
transaction journals and withdrawal-search cursors. Each journal write atomically
includes an encrypted scope descriptor under a separate wallet-derived key. Both
storage adapters enumerate records for export; ownership, descriptor and transaction
ciphertext authenticate before restoration. Existing different records are never
overwritten. Identical records are idempotent, and interrupted restores can resume.
The browser coordinates backup/restore with the same wallet lock as application
operations. CLI collateral secrets also carry encrypted recovery descriptors.

An offline CLI command exports/restores wallet, collateral secrets and journals,
including creating a missing private wallet file. It validates secret commitments,
accepts passwords through non-echoing terminal input or stdin, and never starts PXE,
a node connection or signing. Browser and CLI use the same recovery-file schema.
The runbook contains exact commands and boundaries.

portable-integrated-002.log:184 passing checks including full-size synthetic SDK
transaction serialization, browser/file transfer, actual fresh-wallet CLI execution,
wrong password, corrupted descriptors, competing updates and stale-backup rejection.
portable-browser-002.log:actual built browser with three fresh profiles restores the
original Aztec transaction hash plus Ethereum intent and collateral secret. RPC is
controlled and no external requests were made. These are not new real-proof tests.
portable-artifacts-002.log:80 passing artifact/provenance/CI checks. Canonical SDK
and frontend builds and CLI SDK smoke pass. Binding:source-portable-002.json and
artifact-manifest-portable-002.json. Root self-review caught a missing cross-tab
backup lock and added stability checks; delegated agents remain quota-limited.

Limitations: backups capture only records present at export time. Old development
records without ownership metadata fail export rather than silently disappearing.
Restore cannot detect erased storage or recover transactions created after export.
The supported current records remain latest-intent checkpoints, not an operation
archive. Stale-proof replacement and fee/deploy/moderation consumers remain open;
W03 is active and production readiness is not claimed.

Also corrected the previous milestone source snapshot location from an accidental
nested execution directory to evidence/W03/source-history-001.json; contents unchanged.
