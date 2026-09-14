# Deposit discovery argument regression

The focused lifecycle failed with a zero-filled discovery page while an exact
identity query returned the claimed note. Reordering the two queries did not
change the result (`noir-discovery-diagnostic-3.log` and `-4.log`). A temporary
pass-through oracle observation (`-5.log`) showed the decisive mismatch: the
Noir caller requested offset0 but the actual oracle received offset1, limit10.
The diagnostic used only disposable synthetic test state and has been removed.

Pinned `types/src/meta/utils.nr` generate serialization (lines44–64) introduces
`let mut offset = 0` and then serializes quoted parameter names. The generated
external stub uses this helper without a parameter prefix
(`aztec/src/macros/calls_generation/external_functions_stubs.nr`, lines44–46).
Our parameter named `offset` collides with that local; after serializing the
one-field owner, it serializes the local counter1 instead of the caller's offset.
This is a generated Noir call-interface issue, not missing note delivery or a
reason to bypass wallet synchronization or note ownership.

Rename the argument to `page_offset`; preserve the same positional ABI and
actual pagination semantics. The lifecycle checks page0 contains the exact
identity, page1 and page10 are empty, and no identity remains after consumption.
Full focused/integration results are recorded separately. No upstream package
bytes or compiler checks were modified.
