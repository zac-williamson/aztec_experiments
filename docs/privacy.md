# Privacy boundaries

The board uses private Aztec state and a shared, ownerless fee contract. Users
fund their own private fee credit; there is no coupon issuer or fee-service
operator. Ordinary fees are charged from that credit at the configured maximum,
without an unused-gas refund. Insufficient credit stops preparation; the supported
client does not fall back to a public author fee payer or automatically fund it.

This does not make every part of a user's journey anonymous. The current review
is incomplete, and the application is not approved for production release.

| Observer | Visible information and limits |
|---|---|
| Public chain observer | Published message content and timing, board activity, shared fee payer and aggregate fee pool, public contract effects and encrypted delivery data. Private note contents are not published in plaintext. A shared payer alone does not establish that every other field is unlinkable. |
| Ethereum funding observer | Funding sender, amounts, approvals/deposits and timing. Collateral deposits and refunds are public. Unique amounts, immediate first use and repeated funding identities can help correlate activity. Funding is not anonymous bridging. |
| Aztec or Ethereum RPC operator | Requests sent to that operator, network origin and timing. The client has no built-in network anonymity layer. HTTPS protects transport to the endpoint, not against the endpoint operator. |
| Frontend host | Page/asset requests, network origin and timing. If it also operates the RPC proxy, it can correlate both channels. Hosting security headers do not prevent operator correlation. |
| Reader or moderator | Public messages, timing and published moderation outcomes. Content can identify its author. A small population or recognizable writing weakens practical anonymity. |
| Someone with the wallet or backup password | Local secrets and private state may be exposed. Keep encrypted recovery backups and their passwords separate. Losing all key/secret backups can prevent recovery. |

Changing RPC endpoints changes which operator observes requests; it is not an
anonymity guarantee. Separating hosting and RPC providers also does not prevent
collusion or timing analysis. Do not include identifying information in a post
if that conflicts with the privacy you need. Public onchain content cannot be
guaranteed deletable.

## Evidence and remaining qualification

Genuine native journeys and the complete Chromium deposit-to-refund journey use
the shared fee payer, reconcile private credit and leave the author's public
FeeJuice balance at zero. Focused production-preparer and routing tests reject credit shortfalls,
identity/configuration errors and provider failures before action submission.
These results do not establish a population-level anonymity set.

The current privacy work adds observations of exact known-role occurrences in
named public transaction fields and fixture RPC arguments. It retains fixed
classifications only, not raw request bodies, secrets or decrypted notes. Exact
matches can reveal a problem; absence of exact matches cannot rule out derived
identifiers, encoded calldata or statistical correlation. RPC argument byte
buckets are not network packet sizes. Encrypted delivery fields being public is
not evidence that their plaintext is public.

A genuine same-board test now covers two posts by one author and one by a second
author, with distinct collateral and fee funders. All three used the shared payer;
the inspected public fields contained no exact author or funder address, and no
nonzero note commitment, nullifier or delivery tag repeated across the three posts.
These equality checks do not establish cryptographic unlinkability. Funding
correlation, recovery and the complete supported-browser matrix remain bounded by
their separately recorded evidence. Independent review
must assess cryptographic assumptions. This document deliberately does not claim
protection against arbitrary timing/content analysis, hostile local devices,
malicious endpoints or global network observers.

The first instrumented browser run observed the author address in an Aztec RPC
`getContract` lookup. Its named public transaction fields contained no exact author
match. This is one measured scenario, not proof of general unlinkability. Some
large RPC arguments exceeded traversal limits; their absence results are incomplete.

The pinned SDK resolves private account contract classes through that RPC lookup,
including upgrade/class validation. The application does not bypass those checks.
A local or separately trusted endpoint changes this trust boundary; it does not
remove network-origin or timing information from every observer.

The browser lifecycle fixture (run048) reuses its Ethereum funding identity as
the local sequencer coinbase. The separate two-author test (run049) uses distinct
collateral funders, fee funders and coinbase. Exact funder matches inside transaction objects therefore
cannot, by themselves, establish author-specific funding linkage. The recorded
role-only trace does not preserve enough field context to attribute every match.
The separate public-field classifier and Ethereum funding observations must be
interpreted with that limitation.

Caller-independent public getters now use the SDK's neutral sender, so those
simulation inputs do not unnecessarily carry the author or moderator account.
Focused tests verify the installed SDK constructs a zero sender and fee payer for
these static reads. Private queries retain their owner scope. The complete browser lifecycle now qualifies this change for its recorded source:
its trace retained 1,339 dispatched observations, including five author account-class
lookups and 18 argument classifications truncated by the observation limit. No
other retained row reported the author address. The truncation prevents a complete
absence claim, and the account-class lookup remains. See
`execution/evidence/T03/browser-observations-048.md`.
