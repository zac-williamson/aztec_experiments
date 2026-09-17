# U01 keyboard, focus and live-status source review — 019

Read-only review while browser-post-019 is running. No application source changed and no browser/test process launched. These are concrete source findings and proposed real-browser checks, not an accessibility certification or a completed U01-A02 claim.

## Findings, ordered by practical impact

1. **Automatic refresh destroys the user's reading/focus state.** `refreshBillboard` in both author and moderator pages replaces every post DOM node on each five-second refresh, even when data is unchanged. An opened flagged-post `details` is recreated closed; keyboard focus on its `summary` is removed with the node. Preserve keyed post nodes/open state and focus, or suppress unchanged rendering. This affects reading as well as keyboard operation.
2. **Page transitions do not move focus or announce the new step.** `shared/helpers.js` `showPage` hides old sections via `.page` classes but never focuses the newly active heading/content, and `navProgress` is not a live region. Automatic wallet setup can hide the focused wallet button; navigation can leave focus after all the new step's controls. Provide a named heading with temporary/programmatic focus and meaningful step announcement, without moving focus during ordinary background status refreshes.
3. **Several visible field labels are not associated with controls.** Fee page `azaddr`, `amount`, recovery file input and `recoveryTxHash` have preceding labels without `for` or nesting. Deploy `readyTxHash` also has an unassociated label. Author `moderationPolicyInput` has no explicit label. The built pages preserve these omissions. Add IDs/associated labels; placeholder-only fallback is not equivalent to a persistent descriptive label.
4. **Fee/deployment operation results are silent live updates.** Fee `setupStatus`, `depositStatus`, `claimStatus` and deploy `status` have neither role=status nor aria-live. Their logs can change after a long operation without assistive notification. Author/moderator operation containers and public-reader status already have status semantics. Author `screeningStatus`/`postCountdown` also change after an explicit Refresh chain status click without a live status region; announce a concise result rather than repeatedly reading the full log or every polling tick.
5. **Validation errors lack field association; message highlighting is broken.** Empty-message handling calls `highlightMissing(['msgText'])`, but styles and `clearMissingHighlight` only match `input.missing`; the textarea is not visibly highlighted by that rule and its missing class is not cleared. More generally, no aria-invalid or described error associates the generic operation failure with the field. Add explicit safe field validation messages, associated invalid state, and focus the first invalid field after attempted submission.

Native buttons, file inputs and details/summary are already used, so basic keyboard activation need not be reimplemented. Most author/moderator fields and wallet/configuration fields have explicit or nesting labels. Hidden pages use display:none, so inactive page controls should not be tabbable. No global outline removal was found for these flows; absence of a custom focus rule alone is not a demonstrated failure. Color/zoom/reduced-motion behavior and actual screen-reader speech were not evaluated here.

## Proposed bounded real-browser cases

Use actual built HTTPS pages and native keyboard events; no transaction proving is necessary for these checks. Fixture public reads may populate deterministic public messages, but must be clearly distinguished from real-chain evidence.

- Tab from document start through configuration import, wallet controls and public-reader Open/Refresh. Verify accessible names, visible focus, Enter/Space activation and that inactive page inputs are absent from keyboard traversal. Do not use locator.click as evidence of keyboard operation.
- Enter invalid public JSON using the labelled textarea and activate Import with Enter. Confirm the fixed error is in a status region, configuration stays unchanged, and the textarea remains reachable for correction.
- On author and moderator feeds, expand a flagged post with Space and focus its summary. Let at least two real refresh intervals complete with identical responses. Require the same reading state and a connected, appropriate activeElement. Repeat with a newly added post to catch destructive rerenders.
- Exercise an ordinary step transition and automatic setup transition; require activeElement on the newly active heading or intended first control, a discoverable current-step name, and no focus left in a hidden section. Back navigation should preserve sensible field values without starting an operation.
- On fee/deploy pages, inspect actual accessible control names for the fields listed above and live-region semantics for status containers. Trigger a local validation error through keyboard activation and require the associated fixed error/status. This does not demonstrate screen-reader speech; manual assistive-technology testing remains separate.
- Submit an empty message via keyboard in an appropriately prepared page. Require focus/aria-invalid/associated error on msgText; then correct it and verify invalid state clears. Stop before any valid transaction unless the test is explicitly the genuine funded browser profile.
- With the wallet operation pending, ensure its initiating button is disabled and keyboard repeat cannot initiate another action; do not move focus on each log update. Confirm an error restores an actionable control and a clear safe status.

These tests would address source-defined keyboard usability gaps. The current real browser post driver uses programmatic fill/click and proves no keyboard or screen-reader qualification by itself.

## Source binding

- `shared/helpers.js`: `4e5da80fa0e0756e3901c83ba4109bf8a8b7f537ceb9d6a37f64acd8c17f3dc5`
- `shared/styles.css`: `be0d9ad0907ecad2489190c6f49cbdb17bbb0ab0822e0a74a7d16f406160ea31`
- `shared/wallet-buttons.js`: `42a75630a4251588c2eb96095972c797e4a13ac81be860f931172edcb3d005a6`
- `shared/public-app-config-ui.js`: `0e463fda9990e0a2b45303fd1ba1589863a09feee704a9abde32636e9940ce4a`
- `apps/src/billboard/user/template.html`: `2155d981682824f648a0177f0eab26d6a953bc7f66bc11286367c8e29f659bfc`
- `apps/src/billboard/user/app.js`: `e081a1960e7bcf39bf32a667a7b1add5c517007a56d334a939e5e57f4b668c97`
- `apps/src/billboard/censor/app.js`: `77ffa76e411e25687481b5d6fabf8f7f3c2f9a6cdec4187659c6a386568a9d4d`
- `apps/src/billboard/feed/template.html`: `8bfbd3a45df2fefef8a94bf17b67784dced541c1ed6fc235651764c8b2be070c`
- `apps/src/fee-juice/template.html`: `d7b0be9a48418e4c23f0e043d7a27556ca81c2a1a3f8762880ec0af407883dbc`
- `apps/src/billboard/deploy/template.html`: `05bf4cee4e2466dc820cfd869f4549fbe3392c8a35187a787fde10d23757f612`
