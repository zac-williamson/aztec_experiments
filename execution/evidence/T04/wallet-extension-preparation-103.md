# Real Ethereum wallet route preparation

Official MetaMask v13.49.0 ordinary Chrome extension downloaded from
https://github.com/MetaMask/metamask-extension/releases/tag/v13.49.0
into ignored `.build/metamask-13.49.0/`.

Archive: `metamask-chrome-13.49.0.zip`
SHA256: `7ba00bfe4fe8b0ffb27be1e8fc06506248f1b888cb4f2e5e5e8b1c37f461f262`
The computed digest matches the GitHub release asset digest. Manifest version
is13.49.0.0, Manifest V3, service worker `service-worker.js`. No wallet profile
or user identity has been accessed. Preparation is not qualification.

Independent read-only design review recommends one worker under the existing
bounded-browser supervisor, with disposable Anvil, Caddy and a fresh persistent
Chromium profile. Playwright extension support requires bundled Chromium;
installed Chrome qualification102 remains a separate journey.
Source: https://playwright.dev/docs/chrome-extensions

Test the actual fee-juice.html Ethereum deposit controls, stopping before the
Aztec claim. Supply explicitly fixture-only read-only node identity metadata,
while retaining real Ethereum contracts, extension signing, application funding
code and encrypted request journal. Reject approval first, reconcile the saved
request through normal recovery controls, then approve and deposit. Verify exact
canonical balances/events and no duplicate movement on repeat recovery. Verify
account/network context invalidation and owned process/profile cleanup.

Next: bounded onboarding experiment against the pinned artifact before writing
the integrated test. No new automation framework, alternate wallet adapter,
existing user profile, mainnet funds or silent retry path.
