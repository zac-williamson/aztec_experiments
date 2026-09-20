# Direct board links and automatic loading

Local implementation accepted on 2026-09-20. This does not assert that CloudFront
has been updated, that public posting fee limits are qualified, or that U03 board
browsing is complete.

Readers open a URL identifying Ethereum chain, Aztec rollup address/version and
board. The website supplies public endpoints. The application verifies the board
class, portal and network and loads messages without a wallet or configuration
form. Origin-wide saved settings cannot override an explicit link. Posting and
fee-funding pages use the same verified link and page-local settings. Wallet
setup requires hosted private-fee settings; read-only boards offer a reader link.

Validation used pinned Node 24.21.0 and actual built Chromium pages. The bounded
browser check covers fresh mobile reader loading, reload, stale-setting
independence, invalid network/board links, literal text, removed-message hiding,
no horizontal overflow, desktop posting/funding setup and private-fee gating.
Component checks exercise the real bootstrap/store, mid-load board changes and
read-only hash changes. UI fixtures separately cover keyboard navigation,
older-message links, recovery navigation and operator configuration controls.
All final checks passed and their owned processes were cleaned up.

The real local MetaMask journey passed in 441602 ms (7m22s), peak aggregate RSS
3574976 KiB (3.41 GiB). It used automatic hosted settings and completed collateral
deposit, genuine private claim/post/screen/withdraw proofs and Ethereum refund.
It used official local settlement controls, not network proof generation. This
is local application evidence, not public-testnet author qualification.

Subsequent changes only completed navigation links and the missing-fee message;
application_change_review approved affected UI checks instead of another proof
run. Final built UI evidence is hosted-board-172.json. The earlier UI-only
reload test failed because it still expected origin-persisted configuration;
that obsolete assertion was replaced with a null-before-verification assertion
and the explicitly declared UI fixture setup. The failure is preserved in
hosted-journey-ui-172.json; the repaired check passed as hosted-journey-ui-173.json.

Independent internal reviews: application_change_review reviewed runtime
configuration, script ordering, fee recovery and navigation; retroactive_review
reviewed test boundaries and harness structure. These agent reviews are not an
external security audit.
