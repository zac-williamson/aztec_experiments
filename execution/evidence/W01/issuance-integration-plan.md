# Remaining coupon issuance integration

This is a design checkpoint, not implemented functionality or acceptance evidence.

The application callback being integrated is local trusted code. It receives an
owner address to create a commitment locally. The callback must not send the
owner, blind, auth witness, claim secret, message or ancestry hints to an issuer.
The current genuine harness creates isolated in-memory coupons and registers a
root for each action. That is a composition fixture; it is not a production
issuance pattern or anonymity-set measurement.

Production issuance needs a shared batch, with publicly fixed sponsor, network,
window, batch ID and position available before the client creates its leaf.
The client chooses its blind locally; the issuer receives only the commitment.
A bounded allocation token can identify an ephemeral reservation without a
reusable author account. The issuer collects commitments, constructs the exact
SDK-domain-separated tree and publishes the registered batch and sibling paths.
The client must independently verify the commitment against actual registered
state before authorizing the exact application action. No author signature is
needed by the issuer.

Persist allocation, filled slots, sealed roots and pending registration receipts
atomically. Never reuse batch IDs, reopen sealed roots, charge a window twice,
or report a batch usable before canonical registration is confirmed. Expired,
full, unavailable or underfunded operation must return a bounded explicit error.
An uncertain submitted transaction cannot silently cause a second coupon spend.

Budget and capacity controls can bound total sponsor spending and issuer memory;
they cannot identify humans or prevent all anonymous Sybil exhaustion. Do not
introduce an account/IP allowlist or claim such protection without an explicit
privacy and admission-policy decision. Operational counters should be aggregate
window/batch capacity, reserved funds, fee balance and failures. Request bodies,
allocation tokens, owners and proof inputs must not become logs/metric labels.

The issuer and RPC can still observe connection metadata and timing. Shared
roots and nonidentity-bearing commitments do not provide network anonymity.
Measure and disclose those observations before W01 acceptance. Issuer durability,
transport, operator registration/replenishment and outage/reconciliation tests
remain to be implemented; merely wiring a callback does not complete W01.
