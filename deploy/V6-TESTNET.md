# V6 testnet operator handover

The public application is <https://d30njln0kead8n.cloudfront.net>. The current
network is Aztec **6.0.0-rc.1** testnet, backed by Ethereum Sepolia (11155111).
This matches [Aztec's current network table](https://docs.aztec.network/networks),
which prescribes matching SDK and Aztec.nr versions. npm also publishes newer
prereleases; the deployed testnet remains the version used here.

This is a fresh deployment: V5 accounts, collateral and recovery records remain
associated with the V5 contracts. Keep their original configuration when recovering
old funds. Testnet operation does not satisfy the independent audit and soak gates
for a production release.

## Deployment identity

`prover/live-deployment.json` records the live board, portal, fee contract,
rollup identity, deployment receipts and qualification state. The public website
serves the matching board configuration and V6 SDK/artifacts. The deployment uses
a one-hour moderation window; tests wait for this actual window and normal
testnet finality.

## Remote prover and spending deadline

The prover is Spot instance `i-0025eb05db3c2491c` in `us-east-1b`, a
`c7a.4xlarge` with 16 physical cores and 32 GiB RAM. There is one instance and
one serial worker. CloudFront reaches its private origin; installation SSH
access has been removed. The prover holds no wallet keys.

The Spot ceiling is **$0.40/hour**. The enforced deadline is
**13 October 2026, 08:42:31 UTC (09:42:31 BST)**. The conservative total is
$83.27: $49.47 previously accounted for, at most $28.80 for this revival, and
a $5 ancillary reserve, within the user's $100 total prover-testing budget.
Existing moderator operating costs are separate from this prover campaign.
This is a bounded estimate, not a statement of the final AWS bill. Continuing
beyond the deadline requires a newly budgeted operating period.

The runtime is `/opt/board-prover/releases/v6-20261010`, selected by the
`current` link. Public configuration is `/etc/board-prover/config.json`.
`GET /prover/healthz` reports readiness and aggregate counts. See
[prover operations](prover/README.md) for the service, proxy, queue and trust model.

## Moderator and plugin

The moderator runs on `i-0cb8555882d6cfecc` in `eu-west-2`. Its runtime is
`/srv/board/operator-v6-20261010`; fresh encrypted state is in
`/srv/board/state/v6-20261010`. The local Qwen model and signer have separate
memory limits. The daily backup timer is enabled. V5 runtime and state were
retained. See [AWS operations](aws/README.md).

The `bok` plugin's descriptor is `/plugins/v6/bok.json`. Its V6 escrow is
`0x2eb29b63738c11d92df77dc5c86fdf4b0c6a270f9bb0ad7819181fe63422b178`
and its Sepolia portal is `0x62126e7be3695809b1f9f40df3b1ab2a99f10ed8`.
The existing Mac LaunchAgent `local.aztec.bok` runs the isolated V6 runtime in
`~/Library/Application Support/AnonymousMessageBoard/V6/runtime`; configuration
and secrets are in the sibling `private` directory. Its local health endpoint is
`http://127.0.0.1:8787/health`. The Mac must remain awake and logged in for this
service. GitHub writes and automatic Venice top-ups are disabled.

## Recovery packages

Current runtime, website and host recovery archives are in the existing private, encrypted
backup bucket under
`s3://anonymous-message-board-testnet-backups-nvdhcyurtoga/releases/v6-20261010/`.
The archive filenames are `operator-linux-current.tar.gz`,
`prover-runtime-current.tar.gz`, `prover-host-current.tar.gz`,
`plugin-runtime-mac-current.tar.gz`, and `website-current.tar.gz`.
`current-release-archives.json` is the versioned recovery index. The deployment record contains archive and
inventory SHA-256 values. All inventory files were hash-checked before upload.
The deployment record also contains each S3 object version. These objects expire
on **10 November 2026** under the existing backup retention rule; preserve a
verified copy before that date if longer recovery retention is required. Use
these current archives, which include the V6 CLI identity and plugin checkout
corrections. The host archive contains the verified Caddy 2.11.4 binary archive,
service units, exact public prover configuration and budget bootstrap. Its
bootstrap also schedules a 30-minute commissioning shutdown: cancel that only after
verifying the persistent absolute budget timer. A restore does not extend the budget.

AWS reclaimed the first V6 Spot instance at 12:20:20 UTC on 10 October. The current
replacement restored every runtime file from the verified archive. CloudFront
was switched to a new private origin; all website/security fields outside that
route remained unchanged. Spot capacity can be reclaimed again; repeat this
verified recovery procedure within the remaining budget and original deadline.

Runtime packages contain no wallets. Restore private moderator state separately
from a verified `moderator-state/` backup. Check file hashes, SQLite integrity,
permissions and network configuration before starting any signer. Preserve the
matching configuration, recovery records and website/CSP snapshot for rollback;
changing the website cannot move deposits between V5 and V6 contracts.

## Website transfer encoding

The built SDK and three wallet pages exceed CloudFront's automatic compression
limit. Serve `aztec_bundle.js`, `user.html`, `censor.html`, and `deploy.html` as
deterministic gzip payloads at their existing keys, with `Content-Encoding: gzip`,
original JavaScript/HTML content types and `Cache-Control: no-cache`. Keep CRS and
WASM assets in their existing form. The public content hashes refer to decoded
bytes and remain identical to the build.

`website-content-encoding.json` records decoded and encoded hashes/sizes and the
restore recipe. It is included in the decoded website recovery archive and also saved as a
separate, hash-bound file in the recovery index; restore
both together and verify decoded public hashes plus response headers. Never
upload gzip bytes without their content-encoding metadata. See
[AWS compression rules](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ServingCompressedFiles.html).

## Live acceptance

The fresh V6 deployment passed real-proof Ethereum funding, private claim,
anonymous posting, automatic moderation, paid plugin reply, screening and exit,
and both Sepolia refund paths. The allowed posts and the credible-threat flag
were verified against canonical events and moderator state. The plugin request
and reply were also correctly allowed by the moderator.

The plugin charged **0.000348 test USDC**. Its remaining **0.999652 test USDC**
returned to the test wallet in transaction
`0xbf32ef99658d9e4109d6156cecde8997b616cd2415f8527bc7ae5a23670e97ed`.
The full board deposit, **0.00001 test ETH**, returned in transaction
`0xf562b397d431b56e2ea45564ccdf8a114df69d7765c534ea463699d77d517df2`.
Both exits reached normal V6 finality before redemption. Exact canonical effects,
board principal/liability, wallet balances and gas costs were checked; repeat
redemption attempts were rejected. The test wallet used normal MetaMask
confirmation with its transaction protection enabled.

The board exit succeeded in the browser and paused for settlement. A test-only
commitment-input error then interrupted its final assertion; that error was
corrected and the already completed exit was independently verified without
submitting another withdrawal. The original failed run remains in the evidence.
The later live browser refund passed in full.

The final prover check reported four completed real proofs and no failures;
the plugin was ready and idle, and the moderator had no feed lag or outstanding
errors. Detailed results are in `execution/evidence/V06/live-qualification.json`.

For repeat qualification, use the explicit phases described in
[the public plugin guide](../plugins/public/README.md). Each browser run is
bounded to 540 seconds and 4 GiB. Wait for moderation eligibility, Inbox readiness
and normal network finality between runs. Plugin credit exit must precede the
board exit; then redeem plugin credit before resuming the board refund so its
saved withdrawal record remains available.
