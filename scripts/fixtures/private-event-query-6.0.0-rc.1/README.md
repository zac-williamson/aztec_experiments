# Pinned upstream regression inputs

These two unchanged source files come from the integrity-locked
`@aztec-labs/pxe@6.0.0-rc.1` npm package: `src/storage/private_event_store/private_event_store.ts`
and `dest/storage/private_event_store/private_event_store.js`.
Upstream: AztecProtocol/aztec-packages, yarn-project/pxe.

They are test-only original inputs, checked against the before hashes in
`scripts/patch-private-event-query.mjs` before use. They let the regression suite
compare the upstream store with the patch even after the installed dependency
has been patched. They are never runtime imports or a fallback implementation.
Dependencies and companion store modules still come from the locked package.
