# Expired transaction rejected during block construction

Final observation:
`network-composition-b4361347-63f1-4ecc-a4cd-1246adeba5a3.json`.
The prepared transaction passed ordinary admission and entered the actual paused
mempool before expiry. It remained pending after advancing the disposable clock
past the relevant validation slot and after a repeated submission was rejected.

The test resumed the actual local block builder. A forwarding observer captured
its real failed-transaction removal path without changing arguments, validation
or results. The failure matched the exact prepared transaction hash and the exact
reason `Tx failed preprocess validation: Invalid expiration timestamp`.
The builder produced no block; the receipt became dropped/unmined, the original
anchor and L2 tip stayed unchanged, and the sponsor and author balances did not
change. The observer was restored and the node/wallet/process cleanup completed.

The first run (`c0ab3c68`) already observed those outcomes, but the supervisor
expected a differently named result property. It is retained as a failed overall
run. The corrected supervisor was rerun successfully; the failure was not
rewritten or accepted as the final check.

This supplies actual local builder-expiry filtering evidence in addition to
admission expiry. It is not a claim that an expired transaction was included,
nor a genuine rollup-proof test. The mock-verifier/private-proving-disabled
profile and production integration limitations remain. W01 is still incomplete.

Run with pinned Node:
`node scripts/test-fee-network.mjs --compose --queued-expiry`.
