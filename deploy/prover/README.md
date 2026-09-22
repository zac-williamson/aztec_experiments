# Board prover deployment

Target: one on-demand c8a.4xlarge in us-east-1, 16 physical cores, 32 GiB RAM.
One serial worker; no autoscaling, Redis, public service discovery or wallet on
this machine. The website's operator selects the endpoint. Browser signing and
private execution remain local.

## Build

Use a clean pinned repository installation and an official Linux x64 Node archive
whose SHA256 has been verified against Node's release checksums. Run:

```
python3 deploy/prover/package.py NEW_OUTPUT --node-archive VERIFIED_NODE_ARCHIVE
```

The official 5.2.0 npm package’s Linux binary reports a nightly version label.
The remote runtime accepts that label only with its pinned SHA256, verified against
the package-lock npm archive integrity; it does not accept arbitrary nightlies.

The output contains source, installed dependencies, trusted circuit artifacts,
CRS files, native Linux BB and Node. prover-release.json records every file hash.
The source commit alone does not identify uncommitted changes; those file hashes
do. Copy only this package; never copy .build, wallets or the whole workspace.

## Host

Install the package in /opt/board-prover/releases/RELEASE and point
/opt/board-prover/current at it. Create a system user/group board-prover. Install
board-prover.service into /etc/systemd/system. The host needs no AWS role to prove.
Use encrypted EBS with DeleteOnTermination and restrictive SSH access for installation.
A live deployment must have an explicit spending horizon; trial instances should
have an independently scheduled shutdown within the user's approved budget.

Place the public operator config at /etc/board-prover/config.json:

- host 127.0.0.1, port 8081, proofs real, threads 16
- actual board address, chainId and rollupVersion from published board config
- privateFeeAddress matching that board’s published privateFee.contractAddress
- origins containing the website's exact HTTPS origin
- trustedProxy 127.0.0.1
- queueDirectory /run/board-prover, crsPath /run/board-prover/crs

Set ownership root:board-prover and mode0640. The service writes only in its
systemd RuntimeDirectory, so orphan queue files are removed between starts.
Install a verified pinned Caddy binary and the included Caddyfile, running it as
a separate nonprivileged service on port8080. Caddy overwrites X-Real-IP after
reading CloudFront's appended X-Forwarded-For from right to left. Restrict inbound
8080 to CloudFront's service-managed VPC-origin security group. Never open this
port to the public internet or unrelated VPC callers: the proxy trusts the
private transport, not arbitrary incoming forwarded headers.

## HTTPS route

Create a CloudFront VPC origin referring to the EC2 instance. The website keeps
its existing S3 origin. withProverOrigin in cloudfront.mjs produces the minimal
distribution change: /prover/* uses that private origin, HTTPS viewers only,
caching disabled, all viewer headers forwarded, one connection attempt. Caddy
strips /prover before proxying to the service. Unsupported methods are rejected
by the service. No public origin, additional domain or paid load balancer is needed.

Preserve a copy of the existing distribution config/ETag and published website
objects before updating. Do not overwrite concurrent changes: use current ETags.
Publish the rebuilt pages and their corresponding CSP function together, then
publish board-reader-config.json with remoteProver.url equal to the website
origin plus /prover. Other discovered boards cannot inherit that endpoint.
Invalidate changed paths and verify from a fresh browser. On rollback, restore
matching website/config/CSP and distribution routing before removing the VPC origin.

The current SSO role's extra deployment rights are described by
`deployment-permissions.json`. These are additional to EC2FullAccess and
ReadOnlyAccess. No root credentials or full administrator policy is required.

## Qualification and health

GET /prover/healthz returns mode and aggregate queue/job counters, never witnesses
or bearer job IDs. Check systemd is active and health reports real. Then submit
an actual board transaction from a fresh browser and verify node acceptance and
feed visibility; repeat with remote disabled and then enabled. Native benchmark
time alone is not service acceptance.

Queue capacity is 1000 retained jobs/2GiB, with one active process and 120-second
worker deadline. Pending jobs expire after30minutes, completed results after60seconds.
A restart fails outstanding jobs rather than silently replaying them. The browser
must create a fresh transaction after expiration. Per-IP admission limits do not
prevent distributed abuse. MemoryMax and fixed instance count bound resource use.
No witnesses or job URLs should be logged. The operator can see private witness
information and must be trusted by users.
