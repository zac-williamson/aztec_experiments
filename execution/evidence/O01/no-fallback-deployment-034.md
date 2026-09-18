# Deterministic deployment without fallback

Source edits only; no tests or validation executed. Root coordinates first validation.

The live deploy engine now verifies the exact pinned CREATE2 proxy runtime during network preflight, before loading wallet material, deriving keys, initializing proving, or sending deployments. Missing or unrecognized runtime rejects. Portal creation always uses CREATE2 and its deterministic address; automatic CREATE selection was removed. Explicit CREATE support in the generic Ethereum journal is untouched.

Focused tests evaluate the actual deploy engine and exercise missing, unrecognized and pinned proxy cases. They assert ordered preflight before wallet/prover access and provider cleanup; the accepted case deliberately stops at the next artifact phase, without transactions.

Repository source search found no callers of shared helpers `extractEthAddress`, `portalCreationBytecode`, `computePortalAddress`, or `create2DeployPortal`. Removed those obsolete shared implementations (including zero-address decoding and deployment fallback) rather than maintaining a second deployment path. The live engine retains its own used CREATE2 construction helpers. Deposit extraction and live UI helpers remain.
