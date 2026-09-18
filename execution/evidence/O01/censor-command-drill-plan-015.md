# Packaged censor command drill

Read-only plan, 2026-09-18. No application changes, heavy execution or claim of genuine command qualification. Active recovery inputs remain unchanged.

## Minimum genuine drill

Use a disposable ordinary local fixture and the actual packaged `bin/billboard author` launcher, not a direct SDK surrogate. Deploy a board with censor A and derive successor B using the pinned initializerless account implementation. Warm private fee credit for both identities through existing genuine fixture setup; verify both public author FeeJuice balances are zero. This qualifies command execution with existing credit, not cold-start moderator funding.

1. Run `author transfer-censor` with A's private0600 censor wallet, explicit local node/Ethereum endpoints, portal, public private-fee configuration and B's derived address. Capture real submission/proof validation. Independently check canonical successful receipt and `get_censor()==B`; verify shared FPC payer and exactly one A private maximum-fee debit.
2. In a separate packaged process, run `author set-moderation-policy` with B's0600 wallet and a distinct short UTF-8 policy. Independently verify canonical receipt, exact policy bytes/length, expected policy-version increment and board-bound policy commitment; verify one B private fee debit and unchanged zero public account balances.
3. Run the same policy command under former censor A with acknowledgement of A's already-confirmed transfer hash. Require access-control failure and unchanged policy/version/censor state. Record whether rejection occurs before submission; do not call a generic failure proof of authorization rejection. No fallback to public fees or automatic funding is allowed.

Keep the540second/2GiB outer limits and serial proof execution. Avoid deposits/posts, epoch proofs and settlement: these two governance actions need none. Existing full lifecycle timing leaves little spare capacity, so use a dedicated command profile. If independent PXE startup plus two proofs cannot fit, split transfer and policy qualification into two bounded fixtures (policy fixture initialized with B); explicitly retain the cross-process succession gap rather than pretending independent fixtures establish it.

## Producer/consumer seams to qualify

- `scripts/operator-launch.mjs` routes `author` to the actual user CLI and enforces packaged runtime/environment; `loadCliWalletInputs` selects the censor wallet as both main Aztec identity and censor identity for these actions. No ETH signing wallet or unrelated author wallet should be needed. Test the packaged path, not only `operatorCommand` or engine mocks.
- CLI flags become `newCensor`, `moderationPolicy`, `privateFee`, `censorWalletJson` and journal controls. Use argument arrays, not shell interpolation; only wallet paths and public configuration go in command arguments. Keep secret files/output inside the owned temporary directory.
- `sendCensorPrivate` uses the censor address as private credit owner and canonical shared FPC preparation. Funding only A would make B's policy command fail for credit rather than authority. Existing `test-engine-private-fee.mjs` checks routing with doubles; it does not establish genuine packaged proof success.
- Journals persist across CLI processes. A's negative command must explicitly acknowledge the confirmed transfer, or it may correctly stop at pending recovery before testing old-censor authorization. B needs a distinct owned wallet/PXE/journal scope. Do not delete journals to force progress or silently use `--reconcile-previous`, which can return the previous operation instead of executing a new one.
- Engine transfer's final `get_censor` read is a best-effort logged check; parent verification must assert the exact successor. CLI exit0 or a success string alone is insufficient. Policy packing and version/hash checks must use canonical state, not the same CLI's interpretation.

## Existing evidence and limits

`billboard/billboard_test/src/lib.nr` covers transfer access control/happy path; `c05.nr` covers policy constraints. `scripts/t02-screening-journey.mjs` exercises genuine moderator flagging and `get_post_policy_version`, while C02 evidence concerns screening/moderation semantics. These establish useful contract boundaries but do not qualify the packaged transfer→successor-policy producer/consumer chain. W01 funding/private-fee evidence can be reused for its recorded scope; this drill still needs actual governance transactions and per-owner fee reconciliation.

No definite additional source bug was identified in this bounded review. The likely false-negative traps are unfunded successor credit and unacknowledged predecessor journal; the likely false-pass traps are relying on CLI logging or mocked routing instead of independently verified canonical effects. Daemon handover, queued-job fencing and response-loss recovery remain separate operational scenarios.
