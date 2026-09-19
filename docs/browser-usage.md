# Using the browser application

This guide describes the implemented interface. It is not production clearance
or an independent audit. Use the release's recorded qualification and network
compatibility evidence when deciding where to deploy it.

## Operator: publish connection settings

On `deploy.html`, import the reviewed deployment configuration and load the
specified wallets. Review the network, moderator, policy and deposit settings,
then choose **Deploy**. Preserve the downloadable deployment report. If settlement
is pending, resume with the same configuration and recovery records; the board
is not active merely because its contracts were created.

The optional **Private fee gas settings for the public connection file** box
accepts the reviewed release gas JSON. It has four objects:

- `gasLimits` and `teardownGasLimits`, each containing `daGas` and `l2Gas`.
- `maxFeesPerGas` and `maxPriorityFeesPerGas`, each containing `feePerDaGas`
  and `feePerL2Gas`.

Values are canonical decimal strings. Use reviewed settings for the intended
network and workload; this guide supplies no default gas amounts. The displayed
maximum charge is the gas-limit/maximum-price calculation, not an estimate with
an unused-gas refund. The interface derives the ownerless fee contract address
from the bundled artifact. There is no coupon issuer or separate fee operator.

After successful activation, **Download public connection settings** exports
`board-public-config.json`; **Use this board** installs those settings and opens
the author page. Omitting fee settings produces a public-reading-only file.
Share this public file separately from wallet/recovery files. Host only the built
release using [the HTTPS hosting guide](hosting.md). Its allowed RPC origins must
include the reviewed endpoints: importing different endpoints does not override
the host's connection restrictions.

## Reader: no wallet needed

Open `feed.html`. In **Board configuration**, choose the public configuration
file, or paste its JSON and select **Import configuration**. Check the displayed
network and board addresses. Importing a file is not live verification; **Open
configured board** performs connection checks. Use **Refresh**, **Older messages**
and the expandable flagged-message disclosure to read content and moderator
reasons. Public content remains public even when flagged.

Settings persist across pages on the same origin when browser storage works.
A different origin needs a fresh import. **Clear configuration** or a change from
another tab invalidates the current connection; reconnect before continuing.
This does not delete saved encrypted transaction journals.

## Author: wallets, fees and collateral

1. On `user.html`, import the public configuration including private-fee settings.
   Use **Create wallet** for a new Aztec identity or **Restore wallet** with its
   recovery file and password. Connect the appropriate Ethereum browser wallet.
   Keep the encrypted recovery file and password separately and safely.
2. Follow **Fund private transaction fees** to `fee-juice.html`. Use the same
   Aztec wallet. Your Ethereum wallet needs AZTEC tokens and ETH for Ethereum
   gas; the page does not exchange assets. Deposit AZTEC, download its public
   recovery record, then **Claim private balance** when the bridge message is
   available. The claim fee comes from the deposit, so enough must remain after
   its configured maximum charge. Unused gas is not refunded.
3. Return to the author page and reconnect the wallets. Deposit ETH collateral
   within this board's configured limits. This collateral is separate from the
   AZTEC fee balance. The interface claims the collateral on L2 after its bridge
   message becomes available. Keep recovery records if interrupted. To resume an
   existing deposit, enter its Ethereum transaction hash from the wallet or saved
   recovery record and choose **Claim deposit**. The app validates that exact
   receipt; it does not guess from a partial event-history scan.
4. Post your message. Content is public. **Refresh chain status** checks the
   latest chain timestamp and your note; it does not predict future inclusion.
   **Advance screening** submits a private dummy post, checking up to two earlier
   notes. Real posts must first complete their moderation window, and flagged
   posts add cooldown debt.
5. **Proceed to Withdraw** checks both completed screening and expired debt.
   Missing notes or unavailable chain time mean unknown eligibility, not success.
   The withdrawal transaction checks the contract rules again. After withdrawal
   on L2, use **Claim ETH on L1** when its message is settled on Ethereum.
   Settlement duration depends on the network.

Choose **Export recovery file** after each transaction or recovery update.
An older export does not contain later saved requests. The fee funding recovery
record is public metadata; it does not replace the encrypted wallet backup.
Do not paste either wallet secrets or recovery claims into public configuration.

## Interrupted or uncertain operations

An unknown submission outcome is not permission to repeat a deposit. On the
original configuration and wallet, use **Recover saved Aztec transaction**, or
**Check saved Ethereum request** before **Retry saved Ethereum request**. The fee
page has corresponding Ethereum and private-fee recovery controls. Preserve the
browser profile and exports while investigating. Returning to the original scope
is necessary after switching boards or networks. Contract/node checks determine
whether a saved request can be resumed; a missing note alone proves nothing.

## Moderator

`censor.html` uses the same public configuration and private fee balance. Restore
the authorized moderator wallet to flag posts, update policy or transfer rights.
An Ethereum wallet is needed for funding fees, not for each moderation action.
The board's current authorization and historical post policy remain authoritative.

## Browser support and privacy boundaries

Wallet actions check HTTPS/localhost secure context, cross-origin isolation,
shared memory, WebAssembly, workers, cryptography, Web Locks and writable browser
storage. Passing these checks does not establish that a proof fits available
memory or meets a performance target. Recorded Chromium application journeys cover real transaction proofs. WebKit
26.6 normal-profile checks cover storage, encrypted wallet creation, synthetic
1,100-note persisted history/reopen and one real private-fee post with canonical
node verification. Its full deposit-to-refund journey also passes in6minutes48seconds, using
native-prepared private credit and the disposable Ethereum wallet adapter.
Firefox155 passes the full deposit, claim, post, screening, withdrawal and refund
journey in6minutes18seconds on the recorded host, using native-prepared private
fee credit and a disposable Ethereum wallet adapter. The earlier Firefox146 timeout remains historical evidence. Consult current
release evidence before claiming support. Private/incognito WebKit storage is not
supported by this wallet; readiness rejects it.
If a prerequisite is unavailable, do not bypass the check; public reading remains
a separate wallet-free path.

Private fees hide the private balance spend, not every observable event. Ethereum
funding bookends, amounts/timing, public posts and transaction metadata remain
visible. RPC services and frontend hosts can observe IP addresses and request
patterns. Browser-delivered API keys cannot be secret; configuration must not
contain credentials, query tokens or secret-bearing endpoint paths. Read the
release privacy assessment for the measured guarantees and remaining limits.

For CLI recovery, use `--reuse-tx <Ethereum deposit transaction hash>` and the saved
claim secret. Bare `--reuse` is rejected. Restarting `auto` with an unclaimed
existing deposit requires that hash; a deposit created in the same run already
provides it. If a claim is confirmed but wallet synchronization fails, preserve
its receipt and refresh before another action. Do not make another deposit.
