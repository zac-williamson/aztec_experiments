# UX implementation boundaries

The user interface renders user tasks; it does not own a transaction lifecycle.

## Components

| Component | Interface and responsibility |
| --- | --- |
| Page controllers | Call application commands and read methods; render returned public data. Own form drafts, dialogs, navigation and focus. |
| Application service (`shared/application.js`) | Owns deposit → funding → claim, withdrawal → settlement → refund, explicit recovery, scope validation and transaction acknowledgments. Returns plain data, never PXE/wallet handles. |
| Operation state (`shared/operation-state.js`) | Immutable snapshots and subscriptions: action, stage, status, effective proving mode, elapsed timestamps, safe receipt fields and typed failure. Rendering observers cannot change an outcome. |
| Account service (`shared/account.js`) | Owns custody, passkey selection, imports, exports, session invalidation and safe lock/switch. Public snapshots contain no signing material. |
| Host adapter (`shared/app-env.js`) | Maps the account, network/configuration, durable storage, proving preference and browser facilities into engine ports. Captures the effective proving mode for the whole operation. |
| Engines | Accept an explicit environment/configuration and return results. Perform simulation, proving, signing, submission and canonical reconciliation. They do not inspect DOM elements. |
| Durable journals | Validate and scope saved requests, verify canonical outcomes, and constrain retries/replacements. Page controllers never edit journals. |
| Public reader | Reads verified public events without wallet initialization. Shared message rendering does not import custody or proving code. |
| Prover client/service | HTTP job API with bounded, typed statuses. No UI callback decides whether to regenerate or switch proving mode. |

## Important contracts

- `completeDeposit(input)` is one application operation and has one owner. Double clicks share the operation; a rendering callback cannot split funding from claim.
- Proving preference is a setting for the **next** operation. The application captures the actual mode once; every nested engine call uses that mode.
- `readActivity()` only inspects and reconciles. It does not send transactions. Completed operations are acknowledged only after matching transaction and canonical block identity.
- `completeWithdrawal(plan)` consumes a reviewed account/configuration scope and an explicit maximum preparation count/credit budget. It verifies eligibility before each preparation action. Waiting for settlement is a normal state.
- A moderator recovery review has an application-owned identity, saved transaction hash, exact serialized action and current policy version. Resuming the original proof cannot silently authorize a replacement. A stale proof requires a separate explicit review.
- `prepareDeployment(settings)` is read-only. It binds the connected actors, pinned artifacts and verified network into the manifest the operator reviews. Editing settings invalidates that review. Deployment completion distinguishes contract deployment, hosted reading and checked posting configuration.
- User-visible progress comes from typed stages, never from parsing console output. Diagnostic reports whitelist public operation metadata and exclude signing keys, witnesses and claim secrets.
- Deposit recovery derives a domain-separated secret from the private account and exact Ethereum nonce/scope. Fresh-device lookup validates canonical receipts and checkpoints only public search progress. Older random-secret deposits still require their original recovery material.

## Fee estimation boundary

`preparePrivateFeePayment` verifies the canonical payer and returns available private
credit plus an immutable payment intent. It does not require that credit to cover
the board's entire configured gas ceiling. `estimatePrivateFeeTransaction` consumes
that intent and the application's execution payload through a simulation interface.
It returns the exact payload, reservation and gas settings used for the transaction.
The wallet preserves those settings and validates the full execution again before
proving. The fee contract checks that the reservation covers the signed maximum;
its teardown returns the unused amount privately.

Zero fee prices are used only for local, private-only measurement. Public simulation
uses real configured prices, bounded by network and protocol gas limits. A narrowly
identified refund out-of-gas result may inform a subsequent full simulation; it is
never accepted as successful execution. A failed allocation search is distinct from
insufficient credit and cannot trigger another Ethereum funding payment.

A new-credit funding suggestion remains conservative because an exact bootstrap
claim requires a real bridge witness. This funding policy is separate from the
balance needed to spend existing credit. The UI must not present the operator's
ceiling as an actual transaction fee.

## Verification boundaries

Unit/integration tests exercise the real application and engine boundaries with explicit ports. Browser presentation tests run actual templates and controllers with application doubles; they make no cryptographic or testnet claim. The separate hosted acceptance run uses disposable real MetaMask, real Sepolia transactions and native remote proofs, and independently verifies canonical receipts and the public post event.

Theme-token contrast, narrow layouts, keyboard traversal, field focus, reduced-motion settings, actual 200% Chromium zoom and native accessibility-tree roles/names are checked automatically. This does not constitute a human screen-reader audit or production security qualification.
