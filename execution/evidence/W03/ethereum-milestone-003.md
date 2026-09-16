# Ethereum portal recovery milestone — W03 remains active

Source: `source-ethereum-006.json`, fingerprint
`4fdca3c88be32219471dfd9f36dd1583fa37fa5d6e5440a1e903af2901644e10`.
Pinned Node24.21.0 / Aztec5.2.0 / Foundry1.4.1. No public-chain or real-fund use.

## Delivered

Browser and CLI portal deposit/refund sends require an encrypted intent journal.
The record is durably written before requesting the Ethereum signer, and retains
sender, chain, destination, exact calldata/value, fixed sender nonce, portal
receipt nonce/amount, and deposit commitment when applicable. Claim-secret save
and read-back still precede deposit signing. Shared encryption was extracted from
the L2 journal without changing its key/scope domains or envelope format.

The client validates the actual transaction, canonical receipt and one matching
portal event. An empty portal receipt or consumed Outbox flag is not payment
proof. Successful, reverted and replaced requests have distinct outcomes. A saved
refund can be reconciled after the active portal receipt has become zero.

When the hash is lost before persistence, recovery searches canonical blocks by
sender/nonce. Encrypted cursors checkpoint complete pages; RPC gaps, missing
transaction bodies, broken ancestry and changed anchors never establish success.
Lookup attempts are bounded, and reorgs restart invalidated history. Explicit retry
keeps the original nonce, destination, calldata and value, so an uncertain first
broadcast never becomes a new-nonce payment. Normal recovery does not sign/send.
Wallet rejection preserves intent because arbitrary error text cannot establish
non-broadcast. New actions recheck an explicitly acknowledged canonical receipt.

The UI offers separate check/retry controls; the CLI offers `recover-eth`,
`--retry-ethereum` and `--acknowledge-ethereum-tx`. Connected browser state is refreshed
after recovery. Public errors remain bounded and omit wallet/RPC diagnostics.

## Verification

- `ethereum-integrated-006.log`:182 passing checks, including33 Ethereum journal
  regressions over filesystem and IndexedDB,20 L2 journal checks, actual engine
  custody ordering and receipt/error/recovery integration. Ethereum cases include
  lost hash, crash/rejection before signing response, same-nonce retry, competing
  intents, wrong scope/salt, canonical reorgs, replacements, malformed/missing or
  mismatched refund events, bounded requests and interrupted history beyond500blocks.
- `ethereum-anvil-006.log`: real disposable Ethereum chain and current portal
  artifact. Controlled test bridge roots activate the portal and permit refund.
  A fresh user deposits and withdraws; both signer responses are deliberately lost
  after mining. Fresh journal instances find the real transactions/events, including
  after portal balance becomes zero. Repeated recovery sends no further payment.
  Owned Anvil process exits and disposable directory is removed. No network proofs.
- `ethereum-browser-006.log`: actual built browser reload retains encrypted
  Ethereum intent, restores the same wallet, blocks a new request and retries the
  original nonce/calldata/value. Existing Aztec journal, encrypted wallet/claim-secret
  and cross-tab checks also pass. Browser RPC/signing is controlled; external
  requests are blocked. This browser case is not a live transaction proof.
- `ethereum-cli-sdk-006.log`: actual built SDK through CLI loader boundaries.
- `ethereum-artifacts-006.log`:93 artifact, provenance and affected-client checks.
- `ethereum-sdk-006.log`, `ethereum-apps-006.log`: successful canonical builds.
- `artifact-manifest-ethereum-006.json`, `ethereum-manifest-006.log`: fresh validated
 36-file artifact inventory with1612 inputs.

Root self-review inspected signing order, same-nonce retry, receipt identity,
portal-event binding, cursor ancestry and UI result classification. It caught a
missing explicit elapsed-budget check and ambiguous empty-journal error wording.
No delegated final review or external security audit is claimed after prior quota
failures. Controlled bridge roots qualify Ethereum application recovery, not an
Aztec rollup proof, consensus implementation or target-network deployment.

## Open work

Portable encrypted journal backup; linked logical operations for stale L2 proof
replacement; private FeeJuice funding/approval, deployment and separate moderation
consumers; persistent L2 history cursors; full-stage interruption qualification.
Historical deposit imports still use their separate recovery path. Records are
local latest-intent checkpoints, not a complete operation archive. Storage deletion
or fresh-device key restore does not restore pending provenance. Read recovery may
require an archival RPC for old Ethereum blocks. Stale file locks fail closed.
These limitations keep W03 active and preclude claiming complete production recovery.
