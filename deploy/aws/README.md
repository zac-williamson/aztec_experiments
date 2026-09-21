# AWS testnet deployment

This directory records the London (`eu-west-2`) deployment. CloudFormation creates
the EC2 instance, private storage, static website and CloudFront distribution.
It does **not** install the application, model, wallets or board settings.

The deployed stack is `anonymous-message-board-testnet`. Its moderator uses an
`m6a.xlarge` (4 CPUs, 16 GiB RAM) with a 64 GiB encrypted disk. No network prover
runs on this host. Readers use the static website; the moderator runs the model
and signs moderation transactions on EC2 using its own funded private-fee wallet.

## Infrastructure

Use an authenticated AWS CLI profile and region `eu-west-2`. The template requires
three parameters: `VpcId`, `SubnetId`, `AmiId`. The subnet must provide outbound
internet through an internet gateway; the instance receives a public IPv4 address.
Use an Ubuntu x86-64 image containing the snap Amazon SSM agent: the template's
startup script starts that exact service. The current deployment used
`ami-03cf5768bcc686a8c`; validate image availability and provenance before a new
installation. There is no inbound SSH or model API listener requirement.

Build the frontend first, then generate the template with the actual public RPC
origins. This computes the inline-script security hashes from the built pages:

```sh
node deploy/aws/build-template.mjs /absolute/path/stack.json \
  https://v5.testnet.rpc.aztec-labs.com \
  https://ethereum-sepolia-rpc.publicnode.com
aws cloudformation validate-template --region eu-west-2 \
  --template-body file:///absolute/path/stack.json
```

Create or update the stack using that generated template and the three explicit
parameters. Inspect the change set before execution. The outputs identify the
instance, website bucket, private backup bucket and CloudFront distribution.
Do not submit the source template directly: its page policy must be regenerated.

## Moderator installation

On a controlled Linux x86-64 build machine, use the pinned Node version from
`toolchain.json`, install repository dependencies from the lockfile and complete
the repository build. Produce the operator package using
[the supported packaging instructions](../../docs/operator-launch.md). Packaging
checks SDK, frontend and CRS provenance. Build with the Linux Node executable;
a macOS runtime package cannot run on EC2.

The verified host uses Docker Engine 29.1.3; the runtime requires isolated bridge
network support and verifies its isolation before starting inference.

On EC2, install Docker and the AWS CLI, and create the `board` service account
with `/srv/board` as its home. The account needs permission to run Docker. Install
the package into the exact directory named by `board-moderator.service`.
Keep `/srv/board/state` owned by `board`, mode 0700, and wallet files mode 0600.
Do not put wallet files, recovery material or private state in the website bucket.

Install these public model inputs separately:

- Weights: `unsloth/Qwen3.5-9B-GGUF`, revision
  `3885219b6810b007914f3a7950a8d1b469d598a5`, file `Qwen3.5-9B-Q4_K_M.gguf`.
- Weights SHA-256:
  `03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8`.
- OCI image:
  `ghcr.io/ggml-org/llama.cpp@sha256:15e2235a766c30b62371969bf885b5fe7eb789cdf221fb0b6e75283d9f6b8cb7`.
- Copy the byte-identical `model-image-manifest.json` from this directory to
  `/srv/board/model-manifest.json`. Its SHA-256 equals the image digest above.

Download weights from that immutable revision, verify their digest, and install
at `/srv/board/models/Qwen3.5-9B-Q4_K_M.gguf`. Pull the digest-pinned image.
Also pull the existing proxy image: `docker.io/library/node@sha256:6dac556d980b7f0e5498d08f08cee0ca67798b4ad6c23964a9214920e67758d0`. The runtime checks both images locally and does not download missing images.
The separate limits are 8 GiB for the model, 512 MiB for its proxy, and 4 GiB
for the moderator and signing processes. The model uses four threads and its
API remains private to the runtime.

The service file is the **current testnet instance configuration**, not a generic
new-board configuration. It names the existing portal, moderator wallet, fee
configuration and persistent queue directory. For a new board, use the existing
deployment and author commands to create its contracts and fund its moderator;
then supply that board's actual settings. Reusing an old portal or fee file does
not configure a new board. Testnet ETH and AZTEC funding are separate inputs.

Install the reviewed service file in `/etc/systemd/system/board-moderator.service`,
run `systemd-analyze verify` on it, reload systemd and start the service. Verify
`systemctl is-active`, container health, and the moderation/feed health records in
`journalctl -u board-moderator.service`. An active process alone is insufficient.
Stop gracefully before replacing the package; preserve the wallet and queue.
`Restart=no` is intentional: a failure requires diagnosis, not a restart loop.

## Website publication

Publish only the public inventory produced by `deploy/hosting-config.mjs`, plus
the validated public `board-reader-config.json`. Never sync the repository or
private build directory into the public bucket. Board links contain the network
and board address; ordinary visitors never import connection configuration.

After an HTML change, regenerate `stack.json`, update its CloudFront page policy,
upload the matching built HTML and invalidate changed paths. The page policy and
HTML must contain matching script hashes. Verify the delivered security headers
and open a direct board URL in a real browser. The directory is `boards.html`;
it discovers the supported contract class on the configured network.

## Remaining qualification

The generated template passed CloudFormation validation;
the live service and exact model manifest were checked on 2026-09-21. A complete
fresh-account installation rehearsal remains outstanding. The current model's
small evaluation samples do not establish production moderation quality or
sustained capacity. The application release gates remain in `execution/graph.json`.


## Moderator state backups

`backup-moderator.sh` briefly stops the moderator, copies its wallet, fee settings,
transaction journals, moderation database and private PXE checkpoint to the existing
private S3 bucket, downloads that archive, and checks file hashes and SQLite integrity.
It restarts the same moderator on success or an ordinary command failure. It does not
sign transactions. A killed process or failed host can prevent that cleanup; inspect
service health after any interrupted backup. Do not run manual wallet commands during
backup. State is also private to AWS principals permitted to read that bucket; S3
server-side encryption is not protection from an authorized AWS reader.

Install the script as root-owned `/srv/board/backup-moderator.sh` with mode 0700.
The accompanying `board-moderator-backup.service` and `.timer` run it five minutes
after boot and every 24 hours thereafter. A stopped moderator fails the backup
preflight; the backup does not conceal or repair a failed application service.
Update the release path in both moderator and backup units when deploying a new
package. The script rejects a different active release. Validate the units, then enable
and start the timer. Inspect `journalctl -u board-moderator-backup.service` for the
object key and checksum or a failed backup. No unattended notification destination is
configured by these units. The bucket's existing retention is 30 days.

To restore, obtain the recorded archive and verify its SHA256 before extracting into
a separate mode 0700 directory. Check `metadata/files.sha256` from that directory and
verify the copied SQLite database. Restore the matching verified operator package,
model and unit before placing private state at its recorded paths; make state owned
by `board` with its original restrictive modes. Never overwrite newer transaction
journals with an older backup or start two moderators with the same wallet. Inspect
and reconcile the saved transaction outcome before new signing.

The September 21 drill additionally authenticated the encrypted PXE checkpoint and
moderator-owned journal records from a downloaded archive with networking disabled.
That is an offline state-restoration check; replacement-EC2 recovery and unattended
failure notifications remain separate work.

### Unattended health detection

Install `publish-health.py` as root-owned `/srv/board/publish-health.py` and the
`board-moderator-health.service`/`.timer` units, then enable the timer. The template
allows the instance to publish only in the `AnonymousMessageBoard` namespace.
One aggregate metric is sent every minute; no logs, messages or wallet data leave
the host. The publisher checks the active moderator's current invocation and its
latest structured health record. Missing, malformed or more than ten-minute-old
health is unhealthy. Pending network finality alone is normal. Other alerts are
unhealthy. Command/publication errors remain visible as failed units and missing
metrics. The timer neither restarts the moderator nor signs transactions.

The CloudWatch alarm requires five unhealthy or missing one-minute periods. A stall
can therefore take about fifteen minutes to detect, including the ten-minute
freshness allowance; cold startup and backups may briefly publish unhealthy.
This is AWS console detection only: no email, phone or chat recipient is configured.
The timer is independent of the moderator so a stopped service can still be detected.

This health alarm does not independently detect missed or failed backups when the
moderator remains healthy. Inspect backup timer/service results separately.
