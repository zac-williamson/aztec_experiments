# PR9 UI release — 27 October 2026

[PR9](https://github.com/zac-williamson/aztec_experiments/pull/9) is merged into master at `238d76e252e2bf8c4c64cfc493e6f4d35e14db3a`. Final UI commit `2305be593a7494f5f69085129fdeaba9e078f357` is published at [Rolling Chat](https://d30njln0kead8n.cloudfront.net/#/home), and pushed to master and both existing application branches.

The release introduces the new branding, typography, responsive navigation, post cards and nested conversations. Integration fixed three defects: the deep-thread expander retained an obsolete callback, production publication omitted the new brand assets, and overlapping comment cards intercepted collapse-button clicks. Live comment refreshes also no longer replay entrance animations.

## Verification

- 60 focused application/model checks and 30 publisher checks passed.
- Real browser regression: a deep-thread branch expanded from zero to five to seven children.
- A real reply was included in Aztec block7935, transaction `0x080122e3ef9ec650d483c4a47e944a3c0aeca98fa2b821247530bb679eca3345`.
- A reply to that reply was included in block7936, transaction `0x1e5c559ad76a15c7be7f42c0fca95b2296d0e84fde302606decdd59bff9b871c`. Both appeared in the correct nesting level and the composer closed after submission.
- After reloading the final deployed CSS, pointer collapse and summary expansion worked. Desktop1440×1000 and mobile390×844 layouts were inspected. Mobile navigation opened, navigated home and closed; the home feed loaded. Temporary viewport overrides were removed. No browser warnings/errors were captured in the final check.
- Published assets matched source bytes. All seven core services remained active and public application status reported ready.

## Deployment boundary

Contracts, SDK, wallet worker and running application process are unchanged. The initial asset allowlist update required a proxy restart because its reload API is disabled; live-feed connections delayed shutdown until the existing service deadline. Subsequent CSS publication switched static files without restarting either proxy or application. The app still runs f9d42ce4/PID311339; its next-start source is ui-2305be593a74. Proxy PID427800.

These checks qualify this UI change, not every application flow. New signup/funding, MetaMask extension integration and Bok generation were not rerun for this static release. Previous broader functional results and limitations remain in [the functional report](FUNCTIONAL_CHECK_20261026.md). The performance goal remains paused.

Evidence: `execution/evidence/G21/stable6/ui-pr9/`, including source hashes, live transactions, host activation and desktop/mobile screenshots. No fresh dependency build or additional test browser was retained.
