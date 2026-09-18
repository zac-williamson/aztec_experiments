# First full-journey attempt: handoff schema failure

Outer lifecycle-005.json records148443ms,1041408KiB peak, normal owned-tree and temporary cleanup, failed child. Child application-a3279d8d-b9ef-40bb-94a7-a3f70a67ad91.json records browser-orchestration-failed with no browser process/stage. Genuine fixture deployment, activation and private-fee standalone funding completed; no GUI lifecycle action ran.

Source diagnosis: parent startBrowser exact descriptor-key assertion in scripts/test-c01-application.mjs still expected only the six legacy browser-post keys. New journey handoff correctly added depositAmount and browserJourney; the unchanged assertion rejects it before launch. This is a test orchestration defect, not application proof or network failure.

Retain this failed run. Before retry, implement mode-specific exact descriptor validation with an offline regression for both actual handoff shapes, rejecting extras and mismatched modes. Reconfirm downstream handoff guards and frozen source. The first hypothesis budget is exhausted; a new attempt requires this concrete correction and its checks, not a blind repeat or increased resource limits.
