# Censor helper encoding review

Reviewed root's correction after attempt027: `get_config_hash` decoded value is normalized through `new Fr(n(value)).toString()` before use as Solidity bytes32. No helper/application source edits in this review.

A cheap check used the installed `loadContractArtifact`/`decodeFromAbi`, actual board public-function ABI and actual portal constructor ABI through viem `encodeDeployData`. Confirmed the getter decodes to bigint, its decimal string is rejected as bytes32, and the corrected Fr hex value encodes successfully with the helper's remaining constructor argument shapes. The initial inspection script searched only dispatch functions; corrected it to include `nonDispatchPublicFunctions`, matching where the actual pinned public getters reside.

The same check decoded a real48-field plus length moderation-policy return shape, then executed the helper's bigint/31-byte reconstruction: exact UTF-8 policy and zero trailing padding passed. Policy version is a board-bound commitment, not an incrementing count. Address inputs come from typed SDK address `.toString()`; other numeric getter uses go through BigInt and do not cross a bytes32 ABI boundary.

Reviewed remaining boundaries: genuine funding returns amount/salt/leafIndex consumed as strings by the actual CLI loader; prior022 loader roundtrip and permission checks cover those shapes. Fee max arithmetic mirrors production snapshotGas, which explicitly converts numeric strings. SDK indexed transaction effects expose `l2BlockHash`; canonical block/effect identity checks use that property. Public getters use NO_FROM; fee balance query retains owner scope. No additional concrete ABI/API blocker identified.

This review does not qualify execution beyond the previously reached stage: native funding, packaged WASM proofs, captured transaction inclusion and final accounting still require the bounded genuine run. No expensive tests or live network calls were performed.
