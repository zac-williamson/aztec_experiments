# Claim readiness and safe retry repair

A confirmed Ethereum receipt does not establish Inbox membership at the wallet's
current Aztec anchor. The claim path now retains the authenticated portal event key
and checks its exact index at a refreshed PXE header hash before private-fee
preparation and the sole claim submission. The pinned 5.2 API and tree height were
reviewed directly in the installed source. Normal transaction proof verification
remains authoritative; PXE may refresh its anchor again while proving.

Missing membership returns a bounded pending outcome; unavailable reads and invalid
membership have separate fixed public errors. The 20-second logical read deadline
does not cancel an underlying SDK request. No proof retry loop or public fee
fallback was added. The obsolete fifteen-minute simulation loop in auto mode is
removed; the same bounded claim check applies there.

Recovery uses searched logs only to locate a transaction, then revalidates its
successful canonical portal receipt and active receipt identity before using its
key. The saved secret and Ethereum journal remain in their existing custody stores.
The browser records the confirmed deposit phase before attempting claim, displays
existing-claim controls, and retries only the original transaction hash.

Initial affected check008 retained four fixture failures because older claim
fixtures supplied no message identity/readiness. Their original claim and recovery
assertions remain; fixtures now supply genuine-shaped pinned SDK membership data.
Final integrated checks and full GUI qualification are recorded separately. This
repair does not itself close the broader privacy or browser matrix.
