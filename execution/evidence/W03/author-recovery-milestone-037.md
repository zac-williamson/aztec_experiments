# Author claim, screening and withdrawal recovery

Claims now preserve the exact original receipt, commitment, leaf index, amount,
nonce, depositor and derived private chain. Recovery authenticates custody and
beneficiary, checks the Ethereum receipt hash and canonical block, and bounds
preparation reads. An existing note cannot confirm an unresolved saved claim.
Each claim action makes one submission attempt rather than thirty blind retries.

Screening and withdrawal record their selected chain/sequence and the actual
private deposit-note nullifier. The scoped ACTIVE PXE lookup must return a unique
note with matching owner, board, storage slot and packed receipt/sequence. The
expected nullifier must occur exactly once among the board call's emitted
nullifiers and exactly once in final proof inputs. Linked predecessor records and
replacement proofs must retain it. Changes during proving fail before submission;
a fee-note match alone is insufficient. Successful recovery clears its step guard
before another intentional action. No contract ABI change or extra actor.

Verification:
- author-integrated-037.log:423 passing checks across engine, attribution, actual
  SDK/encrypted journals, portable recovery, history, Ethereum/deployment/fee
  consumers, receipts and artifact/provenance/client checks.
- author-browser-037.log:actual built browser, four fresh profiles with maximum
  two concurrently open; wallet/claim/journal restoration, password rejection and
  tab locks pass. UI chain responses use controlled fixtures. One external request
  blocked; no secrets written to evidence.
- author-sdk-036.log and author-apps-036.log:builds pass.
- claim-supervisor-030.log:68 checks including actual child-process cleanup and
  bounded fresh-snapshot retry. Two failed reads still terminate the native test.
- ../W01/application-74babdac-4283-478d-97ae-5dd5fa9c0909.json:
  genuine attribution/private-fee/withdrawal/refund passed300088ms, peak1620448KiB.
  The real unsubmitted screening proof and real withdrawal proof match the same
  PXE deposit-note nullifier. Withdrawal inclusion consumes that note, the old
  screening proof is rejected, fee accounting and local L1 refund pass. All owned
  processes/data removed. Official local message settlement controls, no network
  epoch proofs. This qualifies attribution and stale rejection, not a combined
  regenerated-screening race on a live chain; that race has client/journal checks.

Failed native assumptions, the sampler interruption and source-freeze overlap are
retained in same-note-native-025-failure.md,028-failure.md,031-failure.md and
034-failure.md. The genuine SDK emits three board-call nullifiers: the final helper
selects the independently identified deposit spend, never assumes a single output.
The actual withdrawal anchor is checked canonically and for eligibility; a newer
checkpoint is valid. No failed run is counted as acceptance.

AI review: withdrawal-review-020.md, claim-note-review-031.md and recorded reviewer
re-review of expected-note selection. Root reviewed final proof binding, exact
operation comparison, retry lifetime, error redaction and sampler failure handling.
This is not an independent external audit. W03 stays active for private fee claim,
deployment and moderator stale-proof recovery, plus final all-stage reconciliation.
Binding: source-author-037.json, artifact-manifest-author-037.json and
recovery-runbook-author-037.md.
