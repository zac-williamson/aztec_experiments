# Welcome and proving controls — 2 November 2026

Owner-approved welcome text is displayed in a first-visit dialog. “Get started” or Escape dismisses it. A browser-local seen marker prevents subsequent visits from reopening it; clearing site storage resets this preference. If browser storage is unavailable, reading remains usable but persistence cannot be guaranteed.

The sidebar Remote proving switch routes the existing PXE through its native remote/local prover setter. It retains the remote endpoint for re-enabling, honors the saved mode at initialization, serializes session creation and speculative drafts, and rejects changes during a foreground transaction. Local mode uses real browser proving; no proof-security flags change. A failed switch retains the previous selection. Preference is saved only after worker acknowledgement.

Independent source review covered the dialog and worker/session lifecycle. Focused browser tests verified exact welcome copy, dismissal, route navigation/reload persistence, and sidebar selection success/failure. Preference, MessageChannel and static-serving checks passed. These are UI and routing checks, not a newly executed local-proof transaction or a complete funded journey.

An unrelated older reader navigation test fails at its synthetic Home “Load more” expectation on both the predecessor toggle checkout and this checkout; it was not used as evidence for these changes. The focused welcome fixture was corrected to await the reader shell rather than a filtered Home item.
