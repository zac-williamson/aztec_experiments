# Unfunded wallet setup extraction

Common account/artifact/canonicalFPC registration and wallet lifecycle moved to
`w01-unfunded-wallet.mjs`. It submits no funding or Aztec transactions. Existing
funded preparation composes it, still selects gas after bridging, and resolves
the wallet dynamically after persistent reopen. Private setup values are
nonenumerable; evidence includes only safe restore observations.

Independent review approved. Actual wallet-absence087 passed369471ms with
peak2227328KiB and allcleanuptrue; report `application-9f9dea22-a152-4552-9edd-dd5dd5d4c57c.json`.
This covers actual cold funding/claim, firstpost, persistentwalletclose, simulated
30dayabsence, reopen without identity/contract re-registration, secondpost and
exact private/shared fee accounting. It is not elapsed soak or browser fee UI.
