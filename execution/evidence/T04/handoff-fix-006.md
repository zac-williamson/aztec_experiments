# Pre-browser handoff schema correction

Attempt005 stopped before browser launch because the parent's exact-key assertion accepted only the legacy six-field descriptor; the new journey producer also emitted `browserJourney` and `depositAmount`. This is a harness integration defect, not application/proving evidence.

Both actual producers now call `createBrowserHandoff`; the actual parent consumes the shared `validateBrowserHandoff`. Legacy mode retains exactly six fields; journey requires exactly those plus boolean true and positive bounded decimal deposit amount. Extra keys, mode mismatch, nonlocal transport and non-owned backup filename are rejected. Parent additionally verifies a regular nonsymlink resolved backup path. Worker validates merged control/handoff exact fields and bounded timeout before launching; native private control uses a fixed four-field validator. No provider payload or secret is echoed.

Failure observations now preserve fixed public stage metadata: bridge catch copies the returned journey coordinator's public observation with passed=false, so failures in later async untilExit/finishAfterSettlement calls are not lost through the preparation-only catch. No raw error object/message is attached.

Offline validation: six helper tests pass, including actual producer-builder JSON roundtrips through parent validator for both modes; negative mode/key/path/amount/control cases; deadline/abort and exit constraints. Syntax checks pass. No browser/proof rerun performed. Root owns attempt budget reassessment.
