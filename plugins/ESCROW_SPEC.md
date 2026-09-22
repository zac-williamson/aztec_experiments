# Per-plugin Aztec escrow — implementation specification

This replaces the fixed Ethereum payment protocol. Each plugin deploys its own
escrow/adapter and has its own user balances. There is no shared billing service.
Amounts are integer USDC micro-units. Funds enter/exit through an immutable
Ethereum token portal; only Aztec controls balances, reservations and earnings.

The board publishes the message and invokes the registered receiver's generic
`on_invocation(account, post_id)` hook in the same transaction. The account comes
from the authenticated private posting caller, never from an HTTP request. A
failed hook reverts the post. The receiver knows the board; the board knows no
escrow internals. This version publicly links the spending account and request.

The reference adapter owns available balances, per-post authorizations, numbered
reservations, measured charges, and operator earnings. Only its operator can
reserve or settle; only the board can create an invocation. Other plugins have
separate storage and keys. A user may have simultaneous invocations, bounded by
the same available balance in this plugin. Withdrawals cannot consume reserves.

Each reservation is identified by (post_id, monotonically increasing reservation
number). The reference service uses one reservation for the whole invocation.
Reservation debits available funds before inference; settlement credits measured
cost to operator earnings and returns the unused amount. Settlement cannot exceed
the reserved amount or repeat. Expiry releases abandoned commitments and closes
the invocation; late settlement fails. Operator misses/failed provider invoices
are operator risk. Disabling the board plugin stops execution; settling incurred
costs remains possible without publishing a reply. Normal completion atomically
settles the accumulated invocation cost and publishes its reply through the ordinary censor path.

The service reads on-chain invocations, verifies the matching finalized board
request, and claims execution on-chain. No execution resumes after a crash. A
reservation stays locked after an uncertain provider result until expiry,
preventing reuse. The service marks the invocation stopped and does not resume it.
Public-network execution waits for finality; explicit
local devnet tests use checkpointed state and official bridge settlement controls.

Provider calls go through an injected metered ModelPort. Quote calculation occurs
before spending using the selected model's input/output prices and a safe input
bound. Output/reasoning cap is bounded by the remaining available balance. No
fixed dollar reservation, conversion constant, automatic retry, premium search,
provider fallback, or post-hoc-only budget check. Actual usage is rounded upward
to micro-USDC. Models whose maximum charge cannot be bounded are rejected.

Frontend: a small plugin account funding/withdrawal panel; ordinary composer and
Post button unchanged. Funding approves/deposits USDC on L1 then claims via Inbox.
Posting needs no additional Ethereum payment or signature. Withdrawal debits on
Aztec then redeems the authenticated Outbox message on Ethereum. Secrets stay local.

Acceptance: real contract isolation/replay/concurrency/expiry/withdrawal checks;
real browser funding, claim, post, live Venice/GitHub response, exact settled
balance, unused refund, and withdrawal. Test insufficient funds before inference,
duplicate invocations/settlements and operator A attempting B's funds. Fixture
minting of a local USDC test token is allowed; account deposit/post/withdrawal must
use the actual UI. No production finality or proof-on claim from proof-off results.

## Contract interfaces and ownership

| Component | Interface | Authority/state |
| --- | --- | --- |
| Board | `on_invocation(account, post_id)` on registered receiver | Registry + canonical post; account is the private posting caller |
| Plugin escrow | `claim(amount, inbox_marker, leaf_index)` | Authenticated recipient consumes one portal credit |
| Plugin escrow | `start(post_id)` | Operator claims execution once |
| Plugin escrow | `reserve(post_id, call_number, maximum)` | Operator moves available user funds into this call's reserve |
| Plugin escrow | `settle(post_id, call_number, actual, receipt_hash)` | Reserving operator earns actual; remainder returns to user |
| Plugin escrow | `complete(post_id, call_number, actual, receipt_hash, reply, length)` | Final settlement and canonical board reply in one transaction |
| Plugin escrow | `cancel(post_id)`, `release_expired(post_id)` | User cancels unreserved work; anyone releases expired work |
| Plugin escrow | `withdraw(amount, ethereum_recipient, earnings, nonce)` | Caller withdraws only their own balance or earned revenue |
| Ethereum portal | `deposit(account, amount, marker_hash)` | Exact USDC transfer creates account-bound Inbox credit |
| Ethereum portal | `withdraw(recipient, amount, nonce, outbox_witness...)` | Valid single-use Aztec message releases USDC |
| Hosted service | `GET /v1/descriptor`, `GET /health` | Public discovery only; no HTTP endpoint can authorize spending |

The escrow owner binds its immutable portal once and can rotate the operator.
Neither the owner nor the operator can directly withdraw a user's balance.
The trusted operator can charge a reserved call up to its maximum: the chain does
not prove Venice invoices. The provider cannot access the escrow. Its wallet is a
separate operator asset, and withdrawing earned USDC is a separate action.
There is no administrator sweep or shared plugin billing authority.

The receiver interface is generic; the USDC account client implements the explicit
`aztec-escrow-usdc/v1` funding protocol. A different hosted service can implement
these same interfaces without changes to the board or composer. A plugin using a
different funding protocol needs its own protocol client, rather than disguising
its internals as this escrow protocol.

## Transaction lifecycle

1. User approves and deposits USDC through the ordinary Ethereum wallet, then
   claims the Inbox credit through their Aztec account. Funding is separate from
   posting, and the UI retains the credit message identifier.
2. User writes `@bok ...` and presses Post. The existing authenticated Aztec post
   transaction publishes and calls the receiver. It either does both or neither.
3. Service observes a canonical invocation, checks the board's finality and
   moderation state, and starts it once on-chain.
4. The service reads available balance, checks provider readiness, and reserves
   that balance once. It waits for finality and refreshes the quote. Concurrent
   reservations and withdrawals cannot reuse those funds. Failed reservation
   means no provider request. Independent accounts run concurrently.
5. Before every paid call it verifies the reservation is still active and has
   sufficient time left, then caps Venice completion/reasoning tokens by the
   remaining reserved budget. Actual charges accumulate in invocation memory.
   Later deposits do not enlarge an existing reservation; they may fund other work.
6. The final measured cost and reply publish atomically on Aztec. Unused funds
   return to available balance; the operator receives earned revenue. All replies
   use the board's ordinary censorship mechanism.
7. User can withdraw available funds on Aztec and redeem on Ethereum once the
   Outbox message settles. Operator earnings use the same withdrawal interface.

An external LLM call cannot be part of blockchain atomic execution. The atomic
boundaries are post + authorization, reservation + debit, and final settlement +
reply. A provider timeout cannot be rolled back: the service stops, keeps the
reservation, and never automatically retries the potentially charged call.

Invocations expire after 24 hours. New reservations require at least two hours
remaining. Production sends wait up to two hours for finalization; the service
must stop rather than spend if confirmation fails. After expiry any caller can
release the reserve, and late billing is rejected. These are conservative defaults,
not a measured guarantee for any particular production network.

## Metering and limits

Prices come from Venice's selected-model catalog in USD per million tokens and
are converted using integer arithmetic. Cached input uses its advertised rate.
Each measured call rounds upward once to a micro-USDC. A receipt hash binds the
model, provider response identifier, and token usage for later inspection.

The current safe input bound is the model's entire published context limit. This
avoids claiming a locally estimated tokenizer count is a provider guarantee, but
requires more available balance than a short prompt will consume. For Kimi's
256,000-token context at $0.56/million, the input reservation alone is $0.14336;
unused funds are refunded. The service caps output to what remains affordable.
An unknown pricing shape, missing usage, or provider breach stops execution.
Provider rate changes or incorrect billing remain operator risk; the contract
never debits more than the reserved maximum. Price-locking is not asserted.

Model selection and GitHub tools live entirely in the hosted service. The browser
only understands registered handles and the funding protocol. GitHub permission
is limited by the configured repository and operator credential. Real writes are
an explicit service setting; tests may read an existing PR without creating one.

## Validation boundary

Local acceptance uses real browser and MetaMask transactions, actual contracts,
real Venice billing and GitHub. The write scenario creates a draft PR and checks
its exact file contents. Only the local test USDC mint and network settlement
controls are fixtures. Each qualification command requires an explicit application
proof setting, recorded in its result. Public-network finality must be qualified
separately; local Outbox settlement controls do not establish that qualification.
Prior fixed-fee test evidence does not qualify this flow. IMPLEMENTATION.md records
which complete scenarios have actually passed.

Provider contract reference: Venice documents `max_completion_tokens` as covering
both visible output and reasoning tokens in its [Chat Completions API](https://docs.venice.ai/api-reference/endpoint/chat/completions).
The metered adapter uses that field rather than relying only on `max_tokens`.
