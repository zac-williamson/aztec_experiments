# Board discovery investigation — 2026-09-20

Read-only review by author_testnet_flow confirmed the pinned V5 node exposes public contract-instance publications through `node_getPrivateLogsByTags`. The API name does not mean these publication events contain private user data.

One live query of blocks 89800–89899, limited to five logs, found the new board at block 89863: `0x1bbe99183f182c179ca47e0acb0ac5d7ad0e2782271ab9d45b85ea4dacf825c9`. Its published class is `0x2d81d5c6d643d9041bde4a0f2767daa1197860dcaaad84b530d5870111085af4` and publication transaction is `0x0e49d3d2407ea2cd332ae1a246ad347edfcb0fd9d083dbf6f41a9e957fdb9936`.

Publication tag: `0x1a7e1badb79abdd38c684b3c8306ffe7ecb33c69e3380d9855730aaaa83a21a8`.

A directory can scan from block 1 to a pinned checkpointed reference, using bounded pages and an exclusive `afterLog` cursor ordered by block, transaction index and log index. Decode with the pinned SDK's `PrivateLog.fromBlobFields` and `ContractInstancePublishedEvent.fromLog`, filter supported classes, and verify current contract identity and portal activation before showing a board as usable. A removed reference block invalidates the scan; do not continue its cursor against a different history.

Coverage must be stated as published instances of supported application classes within the completed scan. Unknown classes, unpublished instances and unscanned history are not established by this mechanism. The old board class is `0x2169e77c5c71c7f36401755e5f6b02517ad892ce904f74b9c5d5e27e560ebb99`; its publication was outside this bounded query. This investigation is not evidence of a complete directory or of compatibility with that older class. No new registry service is needed.
