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

## Observed onboarding investigation

103 failed because the temporary inspection suppressed worker stderr;104 exposed
a diagnostic-only incompatibility: evaluateAll invokes globals blocked by MetaMask
LavaMoat. Removing page-JS introspection without changing extension security made
105 pass in4.5s.106/108 failed before seed entry because source-derived old input
assumptions were wrong.107 observed the explicit SRP-method selection;109 observed
the initial textarea. Packaged5087 code confirms ordinary Space key events create
and focus successive word inputs.110 tests that single explicit keyboard sequence.
All completed inspection processes/profiles were cleaned up. These are setup
experiments, not application qualification, and no real funds were used.

Observed route discovery continued through117. Password creation leads first to
optional passkey setup, then analytics. Open wallet launches the side panel and
retains the onboarding tab.117 reached the real wallet home; review requires a
separate home tab to avoid interrupting awaited onboarding completion writes.
That correction is integrated in the application worker.

118 is the first integrated real-extension/local-chain/application pilot. It failed
at add-network after28688ms, peak3065968KiB, with complete process/profile cleanup.
It does not qualify signing.119 adds fixed request-screen controls and precise
substage diagnostics before any selector change. No repeated unchanged attempt.
