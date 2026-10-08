# Fee setup phase verification boundary

The actual pinned Aztec v5.2 TXE privateCallNewFlow starts calls in the
revertible application phase: it hardcodes minRevertibleSideEffectCounter=1
and sets that on ExecutionNoteCache before executing the requested function.
CallPrivateOptions exposes scopes, utility authorization and gas settings,
not an override for this phase. PrivateFPC correctly rejects fee payer election
there. We do not patch this protocol test environment or weaken the contract.

Positive payment calls require the setup phase and must be tested through real
application transactions rather than this TXE entry point.

Application transaction tests must verify that cold-start funding and subsequent
payments deduct the receipt's transaction fee from private credit. The maximum
is reserved during setup, with unused credit returned by public teardown. Check
successful and reverted application calls, zero refunds, unauthorized completion,
and a second owner's unchanged balance. The published class/instance and nonzero
teardown allowance are prerequisites. TXE setup-phase rejection is not evidence
that these positive refund paths work.

The public TXE checks reject an outsider calling `_complete_refund` and exercise
the zero-refund branch with TXE's zero transaction fee. The latter deliberately
uses the contract address as caller and a dummy partial note: it verifies that
zero refunds skip note completion. It does not establish real transaction
reservation/fee equality or teardown accounting.
