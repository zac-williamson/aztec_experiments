# Verifier and coordinator failure repair

The actual pinned SDK exit-leaf helper now runs in a cheap test against the frozen
Solidity commitment and independently serialized SHA-256 field message. Actual
refund decoding uses an ethers-encoded event and viem parser with wrong nonce,
amount and canonical block cases. Full historical private-note verification remains
a genuine lifecycle requirement, not covered by these read fixtures.

The parent now checks coordinator exit before awaiting its browser promise. A real
detached failed coordinator plus waiting child demonstrates prompt owned-process
cleanup and preservation of the native report. Normal native success still awaits
the browser's normal completion. No application code or proving behavior changed.

An independent source review checked remaining SDK methods, synchronous hashing,
Outbox event/API shapes, historical note status and layout against pinned sources.
Root reviewed the integration and ran23 focused checks in
verifier-supervision-checks-018.log. Each canonically verified browser stage now
records only public receipt identity and emits a fixed progress marker, so a later
failure retains partial observed progress. None of this declares the journey passed.
