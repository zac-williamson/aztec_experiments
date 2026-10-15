# Bounded node and prover package bootstrap

This generator prepares one private EC2 user-data payload. It makes no cloud
calls and starts nothing on the development computer. It installs the reviewed
Linux runtime and a testnet fullnode; **the prover and its proxy remain masked**.
It supplies no Rolling contract addresses. It automatically attempts the reviewed
Linux query qualification in explicit `serviceMode: "query-only"` against the
configured current network. No board address, proof queue or proof worker is
allocated for this exercise. The existing prover service's 24GiB limit is unchanged.

## Current rc3 composition and closed execution gate

This source selects the verified rc3 amd64 image, reviewed normal Rolling catalog
`fafaf3387cdb360e11dff386f30be2fac40e5547ee642cb969aac449b40efb7e`, and
source helper closure from the reviewed lead composition. The public network
snapshot is version `3409706519`, rollup
`0xed1eb2eb670b42e2fb5a478c076a264b9604089d`; it is not fresh target clearance.
Recheck canonical registry selection, all three compatibility constants and
liveness before any separately authorized paid launch. Historical deployment
and failed commissioning records remain unchanged.

The rc6 Linux BB bytes are known, but their version probe timed out under Mac
ARM emulation. The cause is unknown; this is not native Linux qualification.
`toolchain.json` therefore has no active `nativeProver.linux-x64` pin for these
bytes. Both package creation and payload generation reject this state before
creating usable output. They require the exact active rc6 version/hash pair;
historical pins cannot satisfy the gate. The host independently checks that pair
in its fully authenticated release before any binary execution, then requires
the exact version output. This change does not add or promote a toolchain pin.
A reviewed, successful actual Linux qualification and explicit pin update are
prerequisites for packaging, payload measurement and deployment.

Qualification uses the real existing query service, inspector and trusted client.
Its report must include exact `current-network-query-only` scope and
`noProofLifecycle` checks: proof routes disabled, no queue, no worker. Ordinary
proof-service mode is unchanged; passing this exercise never enables proving or
public routing. The node schema still contains `sendTx`, so query-only does not
mean a read-only node RPC surface.

## Reviewed deployment inputs

The lead must first reconcile `execution/infrastructure-ledger.json`, authorize
its reservation, and verify that no old instances, volumes or fleets overlap.
The proposed host is m7a.4xlarge, 64GiB, encrypted40GiB root and one blank encrypted
1024GiB gp3 disk, both DeleteOnTermination. Default gp3 is3000IOPS/125MBps;
acceptance must measure whether this serves the node and serial proving workload.
The node is limited to24GiB with swap disabled. No extra instance profile,
SSH key, SSH ingress, NAT gateway or paid monitoring is required.

Create an owner-only directory outside every checkout, with a600 JSON input:

```json
{
  "createdAt": "YYYY-MM-DDTHH:MM:SSZ",
  "budgetStop": "YYYY-MM-DDTHH:MM:SSZ",
  "commissioningStop": "YYYY-MM-DDTHH:MM:SSZ",
  "runtimeUrl": "https://anonymous-message-board-testnet-backups-nvdhcyurtoga.s3.eu-west-2.amazonaws.com/releases/REVIEWED/runtime.tar.gz?REDACTED",
  "runtimeArchiveSha256": "64 lowercase hex characters",
  "manifestSha256": "64 lowercase hex characters"
}
```

Creation must be within five minutes of generation. Budget stop is at most eight
hours after creation; commissioning stop is exactly thirty minutes after creation.
The archive contains release contents directly, including `prover-release.json`,
not an enclosing directory. Its external SHA256 and manifest SHA256 must be
recorded by the lead after packaging. Node 24.21.0 Linux binary, candidate BB6rc6 binary,
and reviewed Rolling catalog hashes are additionally pinned in this generator.
A changed catalog requires source review; rebuilding an identical catalog with a
new qualification helper needs only new external archive/manifest hashes.

Use a short-lived, object-scoped S3 GET capability, valid for initial download.
This is not an AWS profile or host role, but it is a bearer secret: never paste it
into evidence, print user data, enable shell tracing, or share it with application
processes. No private configurations or wallet material belong in the archive.

```sh
python3 deploy/prover/bootstrap.py --config /private/operator/bootstrap.json \
  --output /private/operator/user-data.gz
```

The output is deterministic gzip cloud-init shell data,600, created exclusively
outside this checkout under an owner-only700 directory. The CLI prints only its
size and SHA256. It refuses output exceeding EC2's16KiB decoded user-data limit.
Pass this binary via the AWS SDK/CLI's normal base64 user-data encoding; do not
base64 it twice. Do not commit the input, generated file, or launch request.

## Independent controls and installation order

The lead must create an EC2 Fleet of **type request**, one On-Demand instance,
zero Spot, explicit persisted ClientToken, absolute ValidUntil equal to budgetStop,
and TerminateInstancesWithExpiration=true. Request fleets cannot be modified
through ModifyFleet. Verify the actual response and readback; a JSON proposal is
not an installed cloud shutdown. InstanceInitiatedShutdownBehavior must be
terminate. Reconcile ambiguous launch outcomes by the original token/fleet; do
not issue a new financial action just because its receipt is missing.

Before any package or image download, the host:

1. Persists the immutable dates and package identity under `/var/lib/rolling-bootstrap`.
   Re-running cannot extend dates or substitute a package. A file lock prevents
   simultaneous writers. Past deadlines fail closed.
2. Installs and activates absolute persistent budget and commissioning timers.
   Shutdown invokes poweroff; the launch template must make that terminate EC2.
3. Masks and stops any prover/proxy, then installs the whole physical ENI HTB
   egress ceiling of50Mbps. This covers Docker forwarding and IPv4/IPv6. It
   verifies the actual root qdisc and configured rate/ceiling using version-guarded C-locale class text and qdisc JSON.
4. Installs a five-second monitor emitting only fixed public console fields once per minute or stage change.
   Missing controls stop services and trigger shutdown. No raw service logs,
   URLs, environment, private account information or exception messages are emitted.
5. Downloads one runtime archive without redirects/retries, validates its hash,
   safely extracts it, validates the manifest and every file, checks native pins,
   runs the pinned Node/BB version checks, and loads the real Rolling catalog.
6. Mounts the dedicated1024GiB data disk by UUID. Only a blank unpartitioned disk
   may be formatted; recorded existing UUID/filesystem must agree on subsequent
   invocation. Unexpected filesystems, mounts or multiple candidates stop bootstrap.
7. Installs Docker if necessary and pulls the exact Linux amd64 image digest.
   Starts only the fullnode. After verifying the budget/egress controls, disables
   the commissioning timer; the absolute budget timer remains active. Then it starts
   the separate bounded qualification job described below.

The image is `azteclabs/aztec@sha256:44479404b67dde931cf8f202a3ce34703876e709ce124924251da8435d5d8651`.
The generator embeds the inspected11October network configuration: registry,
bootnodes, snapshot URLs and read-only blob/transaction stores. It never fetches
mutable network defaults at boot. The node receives this via NETWORK_CONFIG_LOCATION.
Trace and blob-source bypasses remain false and proofs remain real.

RPC is mapped only at127.0.0.1:8082. Admin8880 is mapped only at127.0.0.1:8882
for trusted host qualification pauseSync/resumeSync calls; its exact URL is
`http://127.0.0.1:8882/`. It remains inaccessible externally. The prover user
receives no Docker access. Only40400TCP/UDP is
published for P2P. Security groups must preserve private CloudFront routing and
must not expose node RPC, admin, Docker or SSH. IMDSv2 is used only to read the
host's public IPv4, not credentials. Require IMDSv2/hop limit1 in the launch template.
The runtime and node never receive the Docker socket or developer credentials.

All traffic initially uses the default25Mbps guaranteed class, which can borrow
up to50Mbps. Before a later prover enablement, the lead must mark the dedicated
prover/proxy UID's outbound packets with fwmark20 (IPv4 and IPv6); that class has
a separate25Mbps guaranteed share under the same aggregate50Mbps ceiling. The
aggregate ceiling already applies regardless of marks. Verify counters using a
bounded local/remote transfer before claiming a networking budget bound. The
five-second monitor detects loss but cannot make a lost shaper instantaneous;
include that failure-window allowance in the lead's launch forecast.

## Qualification and recovery gate

Console stage `installed` means installation only, never synchronization or
accounting acceptance. `linuxQueryQualified` remains false until the single
qualification attempt passes every required check and cleanup. The lead reads sanitized console output using the supported EC2 API,
verifies Fleet expiry and volume deletion controls, and checks actual canonical
identity/sync through the reviewed runtime qualification procedure. The bootstrap
does not unmask the prover or install an application config. The reviewed
`prover/qualify-runtime.mjs` must be included in a freshly hash-bound runtime archive.

The compressed Docker image is about540MB; the inspected snapshot objects total
68,390,965bytes. Decompression, catch-up, RPC throttling and shared CPU/I/O remain
unmeasured. Do not promise eight-hour acceptance. Never widen deadline, memory,
trace or proof guards just to obtain a successful startup.

A failed bootstrap emits only its fixed stage and shuts down. Partially extracted
packages are never executed or overwritten. Retry requires diagnosis and a new
lead-approved host/package with its own forecast. The original fixed expiry
remains in force. A normal reboot preserves the UUID data mount, budget timer and
shaping prerequisite. Runtime archives/evidence required after termination must
be retained externally within the ledger; the node database is deliberately
rebuildable and DeleteOnTermination, not an unbudgeted retained volume.

## Development checks

```sh
python3 scripts/test-prover-bootstrap.py
```

These are labelled unit fakes plus real shell/Python syntax and archive/file
validation. They do not execute Linux services, cloud operations, Docker, proofs,
private credentials or model calls. An actual Linux bootstrap remains a separate
reviewed commissioning exercise.

### Traffic-control format provenance

Ubuntu 24.04's reviewed iproute2 packages are `6.1.0-1ubuntu6` and
`6.1.0-1ubuntu6.4`; the host checks both the package version and `tc -V`.
Contrary to current upstream main, these packages do not support JSON class
output. The parser uses `tc -s class show dev ENI`, requires all three exact HTB
class identities/parents, 50/25/25Mbit rates and 50Mbit ceilings, and requires an
unsigned 64-bit `Sent` byte counter for every class. Missing counters never become
zero. Qdisc JSON must report the unique root `1:` HTB and default class `0x10`.
Unknown versions/formats fail commissioning; there is no alternate guessed format.

Source evidence: [Ubuntu source archive](https://archive.ubuntu.com/ubuntu/pool/main/i/iproute2/),
`iproute2_6.1.0.orig.tar.xz` SHA256
`5ce12a0fec6b212725ef218735941b2dab76244db7e72646a76021b0537b43ab`,
`iproute2_6.1.0-1ubuntu6.4.debian.tar.xz` SHA256
`d127ad985c91e0cc4192876721e533efc893deed08e256b3662205d8401552cd`.
The Ubuntu patch series changes HTB burst parsing, not its class output.
Upstream matching sources: [tc_class.c](https://raw.githubusercontent.com/iproute2/iproute2/v6.1.0/tc/tc_class.c)
(print_class), [q_htb.c](https://raw.githubusercontent.com/iproute2/iproute2/v6.1.0/tc/q_htb.c)
(htb_print_opt), [tc_util.c](https://raw.githubusercontent.com/iproute2/iproute2/v6.1.0/tc/tc_util.c)
(print_tcstats2_attr), and [tc_qdisc.c](https://raw.githubusercontent.com/iproute2/iproute2/v6.1.0/tc/tc_qdisc.c).
The root class relationship follows Linux6.8 `htb_dump_class`.

Fixtures are source-derived development cases, **not captured Linux evidence**.
The default rate formatter rounds below 1Kbit/s at these rates; the installation
sets exact rates but text readback cannot distinguish that sub-Kbit variation.
Reserve this small tolerance in the forecast and verify actual Linux shaping and
counters before workload acceptance. The five-second monitor interval is not a
hard five-second shutdown bound: scheduling and command/poweroff latency also
need budget allowance. This repair does not waive either commissioning gate.

### Automatic Linux qualification, without a remote shell

`rolling-qualification.service` starts once after installation and uses the
packaged Node 24.21.0 and reviewed qualifier. Its cgroup allows loopback networking
only; node P2P/L1 synchronization runs in the separate node service. The job has a
private temporary directory, read-only system/release, empty capabilities,
`LOG_LEVEL=silent`, no `NODE_PATH`, `NODE_OPTIONS`, `BB`, Docker socket, host IAM
role or wallet. The process group is terminated at 105minutes at the latest;
readiness is additionally bounded by creation+90minutes and the complete job by
budgetStop−60seconds. The original 30minute timer protects installation; it is
retired only after installation and verified controls, never extended for sync.

The direct node readiness probe uses installed `createAztecNodeClient` with a
bounded, no-redirect/no-retry transport and `inspectTrustedNode`; it does not
mistake raw node RPC for the trusted service `/healthz` interface. Each poll
checks actual network/proof identity, coherent canonical anchors, world-state
synchronization and ≤120second L1 lag. Only public readiness data is queried.
The loopback addresses are RPC8082 and admin8882.

Scope is the reviewed rc3 snapshot: Sepolia11155111, rollupVersion3409706519,
rollup`0xed1eb2eb670b42e2fb5a478c076a264b9604089d`. It must be refreshed against
canonical registry/compatibility/liveness before launch. The config explicitly
says `serviceMode: query-only`, `proofs: real`, loopback port0 and empty `origins`.
There is no board or proof-worker configuration. No proof job, model call or wallet
action is submitted; the API's unchanged `sendTx` method is not advertised read-only.

An exclusive fsynced intent is recorded before readiness polling. Then exactly
one qualifier invocation has at most 15minutes. It tests actual healthy client
composition, wrong chain/version/rollup rejection, proof configuration floor,
elapsed staleness after supported pauseSync, rejected stale queries, resumeSync
and recovered canonical queries, removed-helper startup rejection, unchanged
manifest and child/service/file cleanup. No second attempt follows a failure,
reboot, timeout, lost receipt or incomplete journal. The systemd post-stop action
turns an interrupted attempt into `interrupted-unknown`; qualification failure
requests the existing budget shutdown. If killed during pauseSync, there is no
claim that the node recovered: the host shuts down and remains unqualified.

Durable owner-only records live under `/var/lib/rolling-bootstrap/qualification`:
intent, fixed config, canonical readiness, original bounded qualifier report and
safe projected result. The existing console channel emits only validated
booleans, public network/canonical anchors, fixed stages, manifest and report
hashes. The lead can independently compare the canonical hashes and every check
via the AWS console-output API. No raw logs/errors/configuration or capability
URL enter the console. A success remains **current-network Linux query qualification**,
not genuine Rolling proofs, privacy acceptance or production release.

The host also records HTB parent bytes before and after its bounded installation
transfers and requires a positive, nonreset delta. Console `egressExercise`
identifies this as `installation-egress-not-throughput`. It observes actual
traffic accounting, including transport acknowledgments; it neither measures a
50Mbps throughput limit nor proves the complete future networking budget bound.
The lead must retain latency/failure allowances and perform separate bounded
throughput commissioning before asserting that bound.

The qualification socket allowlist includes `AF_NETLINK` solely so its mandatory
`tc` class/qdisc readback can open a local routing netlink socket. This follows
[iproute2 v6.1.0 libnetlink.c, rtnl_open](https://raw.githubusercontent.com/iproute2/iproute2/v6.1.0/lib/libnetlink.c)
and [systemd v255 RestrictAddressFamilies](https://raw.githubusercontent.com/systemd/systemd/v255/man/systemd.exec.xml).
`CapabilityBoundingSet` remains empty (no `CAP_NET_ADMIN`); `AF_PACKET` is not
allowed, and IP access remains loopback-only. The regression models these exact
source-backed socket dependencies while executing the real control verifier;
it is not evidence of Linux seccomp/netlink operation. Actual Linux commissioning
must confirm that read-only traffic-control inspection succeeds under this unit.

### Early failure diagnostics

The first remote commissioning attempt terminated with the EC2 reason
`Client.InstanceInitiatedShutdown`, before any readable bootstrap record. Both
latest and cached console output were empty. Its exact failing step remains
unknown; these diagnostics do not assert a root cause or authorize a repeat launch.

Before checking the platform, creating state, acquiring the writer lock or
installing controls, the host emits `ROLLING_BOOTSTRAP_DIAGNOSTIC`. Subsequent
fixed step names identify deadline/timer creation, timer activation, masking,
route inspection, shaper activation, tc version/package checks, class parsing,
qdisc parsing, download/verification and qualification installation. Failure
records contain only a fixed category and, for an actual subprocess exit, an
integer return code in −255..255. Numeric tc/libbpf/Ubuntu package version
components are parsed from whole matching strings; unrecognized text is omitted.
The class output is labelled only class-text/json/empty/other. No raw output,
commands, arguments, exception messages, URLs, configuration or user-data content
is emitted. Bootstrap HOST source SHA256, manifest and native/catalog hashes
bind the bounded evidence to reviewed code and artifacts.

The sink attempts `/dev/ttyS0` and `/dev/console` as existing character devices
using nonblocking, no-follow opens, one bounded write and no retry/fsync. It does
not create devices, change a getty, modify GRUB, enable interactive serial access
or alter account permissions. AWS documents ttyS0 as the Linux EC2 serial port:
[EC2 serial console ports](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/connect-to-serial-console.html)
and [EC2 console output retrieval](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-console.html).
The target remains the inspected Canonical Ubuntu Noble x64 AMI; delivery on that
host still requires live evidence. Unsupported/missing/full sinks are tolerated,
and sink errors never replace the original failure or prevent shutdown attempts.

Failures before the deadline/interface files exist now reach the same safe
shutdown path. A missing/unavailable budget service causes direct poweroff to be
attempted; both subprocess attempts have ten-second limits. The independent
cloud expiry remains unchanged. Tests inject timer, mask, shaper, version/parser,
early filesystem and diagnostic-device failures without running Linux services.
They demonstrate projection and control flow, not successful remote commissioning.
A subsequent launch requires independent source review and a reconciled forecast.

### Runtime bucket region preflight

The actual archive bucket is in **eu-west-2**, independently read via
`GetBucketLocation`. The earlier us-east-1 endpoint returned HTTP301 with the
bucket region header eu-west-2. Delayed console evidence showed controls passed
before package-stage failure; the stopped attempts are not evidence of Linux
qualification. The generator now accepts only the bucket's correct eu-west-2
HTTPS hostname. Its no-redirect/no-retry download policy is unchanged, and tests
explicitly reject the former us-east-1 hostname.

Before a replacement launch, the trusted lead must reconcile the bucket region,
create the object-scoped GET capability using that actual region, and perform a
single bounded `Range: bytes=0-0` GET **without following redirects**. Require
HTTP206 with the expected one-byte Content-Range/object length, and bind the
intended object to the independently verified archive SHA256/manifest. Keep the
capability URL private; retain only status, region and safe object/hash facts.
HTTP301/307 or any other unexpected response blocks launch for diagnosis rather
than changing the host's redirect policy. The compute region can remain us-east-1;
account for this cross-region archive transfer in the existing forecast.

### Final commissioning receipt and optional private retention

The third host reached its readiness deadline without a retained final receipt.
The read-only diagnosis did **not** establish a node startup cause. The next
reviewed bootstrap records fixed inspector categories (`CONFIG`, `IDENTITY`,
`UNAVAILABLE`, `UNSYNCED`, `STALE`, process exit or timeout), poll count, and the
last fully validated ready network/anchor snapshot. A failure category is not a
partial successful synchronization check. No raw RPC error or request is kept.

`rolling-qualification.service` retains its loopback-only policy, empty
capabilities and existing deadlines. Its namespace additionally hides
`/var/lib/rolling-bootstrap-private` and cloud-init's `/var/lib/cloud` tree.
The post-stop command first seals an interrupted result, then synchronously
starts the **separate trusted root** `rolling-qualification-receipt.service`.
It does not give the qualifier external network access or a PUT capability.
The trusted publisher has a35second service deadline; the caller waits at most
40seconds inside the unchanged45second stop budget. The independent cloud and
budget shutdown controls remain active throughout.

The publisher reads only bounded, no-follow JSON records. It projects exact
qualification fields and inspects two fixed systemd units plus the fixed
`rolling-node` container, each with a3second command limit. Service evidence is
limited to load/active/substate/result and integer main exit code/status/restarts;
container evidence is status/running/restarting/OOM/exit code. Unknown or malformed
responses become `available:false`, never healthy. No Docker config, environment,
`State.Error`, logs or journal is read. The single-start container is retained
until host termination so an exited/OOM State can be inspected; `--log-driver
none` prevents retained Docker logs. No restart or extra storage resource is added.

Before any shutdown request, the publisher exclusively creates and fsyncs
`/var/lib/rolling-bootstrap-private/final-receipt.json` and its directory, then
synchronously attempts the existing bounded serial/console sinks under
`ROLLING_QUALIFICATION_RECEIPT`. Receipt scope is `current-network-query-only`; old-scope receipts cannot qualify this candidate.
Only a fully checked complete result qualifies; a receipt is never permission to
unmask the prover. Reinvocation does not replace/re-emit the receipt or upload it
again. Disk failures produce only a fixed `FINALIZATION_FAILED` console attempt
and preserve failure shutdown. Hard power loss, forced cloud expiry and console
sink failure can still prevent external delivery; missing evidence never proves
health and never authorizes replay or a paid replacement.

The lead may supply optional **private** input `receiptPutUrl`: an AWS4-HMAC-SHA256
presigned PUT with only the `host` signed header, at most8hours validity, to the
exact existing bucket endpoint:

`https://anonymous-message-board-testnet-backups-nvdhcyurtoga.s3.eu-west-2.amazonaws.com/receipts/CAMPAIGN/FINAL.json`

Campaign and filename stems allow only letters, digits, underscore and hyphen,
1–80characters each. The lead creates a fresh object-scoped capability for the
reviewed campaign; it must not be copied into source or evidence. Credentials,
fragments, path escapes, other buckets/regions, arbitrary query fields and
redirects are rejected. The URL is stored only in the root private directory,
never the qualifier config, attestation script or output. It has no host IAM role
or general S3 privileges. URL signing is not performed by this generator.

The publisher uploads only the sealed sanitized receipt (maximum16KiB). Before
one request it exclusively writes/fsyncs `upload-intent.json` with receipt hash
and attempt count1. A partial/existing intent blocks another upload, even with
no result. The5second HTTP request uses no ambient proxy, redirect, credential
provider, cookie or retry. Response bodies are not read. A fixed acknowledged,
rejected or unknown outcome is persisted separately; errors and URLs are never
serialized. HTTP acknowledgement alone is not independently verified receipt
retention: the trusted lead must read the private object and compare its hash.
Upload uncertainty does not replace the durable receipt or replay the request.
Failure shutdown follows the bounded publication attempt; the upload does not
extend any deadline. Temporary capability and node state disappear with the
already required DeleteOnTermination volumes. Retained receipt-object storage
belongs in the shared spending ledger.

Development tests exercise strict schema projection, secret-bearing/malformed
inputs, state/timeout/exit paths, receipt ordering and fsync boundaries, redirect
rejection and once-only upload with explicitly labelled fakes. They do not claim
Linux systemd namespace enforcement, actual S3 delivery or remote node readiness.

The private shell embeds its Python program using standard-library LZMA; AWS
user-data remains an outer gzip file. The inner representation uses LZMA's
standard `FORMAT_ALONE`, preset6 with byte-position bits0, and a short quoted
heredoc. Python executes the decompressed bytes directly. This changes encoding
only: decoded program bytes, shell fail-fast/umask, capabilities, source hashes
and every control remain intact. Outer gzip retains its checksum; archive and
manifest SHA256 verification remain mandatory. Stronger default presets did not
fit the measured private05 inputs. The measured representation had only49bytes
of headroom before the required changed source-hash binding, so no future input
is assumed to fit: every actual payload must pass the unchanged16,384byte gate.
A source change still requires a fresh hash-bound runtime package.

The selected Canonical image must have
Python3's `lzma` module available (verify this image dependency before launch).
Generation removes Python comment tokens only, preserving executable tokens and
string bytes, then hashes that actual decoded HOST source as
`bootstrapSourceSha256`. Encoding round-trip tests execute the generated
function definitions and verify that source hash, without executing host actions.
Tests include two capabilities with a shared synthetic1024byte session token and
reject oversized4096byte capability pairs through the real CLI. Size depends on
actual private inputs: the unchanged16KiB output gate fails before creating
user-data, never truncates a URL, and never removes a check to fit. A generator
failure is a local packaging blocker, not permission to launch with altered data.

### Bounded startup observations

The node unit now invokes the reviewed, packaged `deploy/prover/bootstrap.py`
wrapper around the same single foreground Docker command. Docker resource/network flags, hash-only admin configuration, `ExecStop`, restart policy and
45-second stop budget remain unchanged. No extra service or retry is introduced.
The public wrapper source enters the runtime manifest; its exact hash is also
pinned by generated bootstrap controls and checked before node execution and
receipt inspection. Rebuild the runtime package before using this bootstrap:
older archives lack the wrapper and fail closed. Private generated configuration
and capabilities never enter the runtime package.

The wrapper drains combined stdout/stderr in chunks of at most4096bytes, retaining
at most8192bytes of one line in memory. Longer lines are discarded completely.
Only fixed stage/error enums, a bounded oversized-line count and exit code or
signal reach the owner-only `node-startup.json`. Raw lines, matched values, URLs,
keys, arguments, stack traces and errors never enter durable evidence. Repeated
markers do not cause repeated writes. Shutdown signals are forwarded to the
single child, which is reaped; its exit code/signal is retained and propagated.
Existing systemd controls remain responsible for stopping a hung process/container.
Hard termination can leave an explicitly incomplete observation.

Final receipts add a bounded `startup` object read by the hash-verified helper,
with a3-second inspection limit. Missing, malformed or changed helper/data yields
`available:false`. Stages identify observed SDK log signatures only; they neither
prove readiness nor establish an error's cause. Unknown failures remain unknown.
This diagnostic does not repair or explain the earlier remote node exit1.
The raw admin capability handoff from the preceding reviewed change is unchanged;
this wrapper sees only the configured hash in the trusted unit arguments.

Tests use adversarial byte streams and short disposable Python children, including
signal termination; they do not run Docker or qualify a Linux node. Package tests
check exact copied source and manifest-inventory inclusion without private inputs.

If observation I/O or another wrapper operation fails after spawning the child,
the wrapper sends at most one TERM, waits at most2seconds, then sends at most one
KILL and waits at most2seconds. It re-raises the original failure, with separate
fixed cleanup flags; a cleanup failure cannot replace that exception. When
storage still works, the sanitized observation also retains those flags and the
actual reaped child exit/signal. Failed storage may prevent this record; systemd's
unchanged cgroup/stop budget remains the last resort. Regression tests inject
ENOSPC at the first post-spawn receipt fsync after a real disposable child starts, covering ordinary
termination and a child that ignores TERM. No Docker process is used by tests.

## Configuration provider adapter and bounded startup stages

The runtime packages the exact relative-import closure of
`deploy/prover/startup-stages.mjs`: `prover/compact-node-transform.mjs`,
`prover/compact-node-registration.mjs`, `prover/compact-block-native.mjs`, and
`shared/trusted-private-node.mjs`. The wrapper captures all five regular files
(maximum 1MiB each) and checks every source hash before creating either destination.
Symlinks, missing or changed files fail closed. It exclusively creates a 0700
`startup-code` directory containing those five files only, and a separate 0700
stage directory. It mounts code read-only at `/usr/src/yarn-project/rolling`
and imports `/usr/src/yarn-project/rolling/deploy/prover/startup-stages.mjs`.
No package `node_modules` or nearer dependency directory is mounted: all SDK
imports share the image's `/usr/src/yarn-project/node_modules` identities.
The compact registration helper remains opt-in; this bootstrap does not set
`ROLLING_COMPACT_TIER`, and query-only qualification is not compact-route acceptance.
The foreground Docker process, limits, no-restart policy, admin authority,
shutdown controls and qualifier sandbox remain unchanged. A prior directory is preserved and prevents
another launch through this wrapper. No extra capability or authentication key
is introduced. The generated host program has no extra embedded diagnostic code;
its existing startup-source hash changes and still requires fresh packaging and
actual <=16384-byte user-data verification before a separately authorized launch.

The helper requires Node 24.21.0 and uses the official synchronous
[`registerHooks` API](https://raw.githubusercontent.com/nodejs/node/v24.21.0/doc/api/module.md).
Offline extraction from the pinned image found the 24.21.0 public header and
byte-identical startup/factory modules. A real Mac Node 24 hook test validates
replacement, untouched unrelated imports and deregistration; this is not a
Linux node startup test. Before the CLI imports, all six instrumented module hashes
and unique insertion anchors must match. At load time the original returned
bytes are checked again. Fixed begin/complete markers and the reviewed compact registration import are inserted. The registration uses the actual CLI-created node; no second node lifecycle is introduced.
The one complete CLI `getL1Config` call also selects the fixed PublicNode URL
in place of its `nodeConfig.l1RpcUrls` argument. All other arguments, the awaited
complete result, genesis comparison, config merge, errors, retries and cleanup
remain intact. Reversing the configuration argument replacement, marker insertions and compact registration import recovers the exact original module bytes. SDK/image files on disk are unchanged.
This execution has an explicit **semantic configuration-provider adapter plus
instrumentation**; it is not an unmodified-image qualification or merely logging.

The 35 intervals cover registry validation, rollup compatibility, L1 configuration,
genesis comparison, telemetry, factory crypto/key-store/address/blob/snapshot/
world-state/AVM/archiver/verifier/fee/P2P startup, and public/admin RPC binding.
A begin without completion identifies an interval, not its error's cause. Marker
I/O failure is sticky and cannot replace the application's result or thrown
object. The helper emits no stdout/stderr diagnostics. Its recorder never receives a raw error, URL, runtime configuration or identity;
a separate bounded classifier inspects only actual typed errors for numeric
HTTP/RPC status or fixed blob/old-block categories. Provider selection remains
a fixed source-level literal rather than a runtime input.

`startup.instrumentation` reads only `startup-stages/stages.json`: an owner-only
regular file, maximum 8192 bytes, with strict schema, helper digest and a bounded,
properly nested history and exact `runtimeAdapter: "publicnode-config-v1"`
label. A missing/incorrect adapter label is rejected, including old diagnostic-only
records. Unknown phases, extra fields, duplicate/reordered
completions, changed digest, symlinks, nonregular files and public permissions
are rejected. The fixed directory is separate from combined native output;
marker-looking exception text cannot become a stage record. This is evidence
from the trusted pinned runtime, **not attestation against a malicious process**
which could write its own record. Availability or completion never substitutes
for the actual trusted-node readiness and Linux qualification gates.

Cheap checks (no Docker execution, node startup, proof or archive build):

```sh
node --test deploy/prover/startup-stages.test.mjs
python3.12 -u scripts/test-prover-bootstrap.py
PROVER_VALIDATION_NODE=/absolute/path/to/pinned/node python3.12 -u scripts/test-prover-package.py
```

Use an explicit Python 3.12 or newer interpreter (the available Python 3.14 is
also supported), not macOS's older `/usr/bin/python3`. The bootstrap tests reject
an older interpreter before running: archive safety depends on the standard
library's `tarfile` data filter and `FilterError`. CLI children use that same
interpreter. Verbose test names and unbuffered output identify a stalled case
without waiting for the whole suite to finish. Successful payload CLI checks use
a clearly labelled isolated qualified release fixture; the actual repository's
missing Linux qualification pin must still reject generation without output.
The real CLI test uses an owned external temporary directory, so a supervisor's
in-checkout `TMPDIR` cannot cause a path rejection to masquerade as a native-pin
check. Disposable termination tests own a process group and bound pipe draining
on both success and failure. The disk-full injection targets persistence after
child creation, independent of earlier source-mount writes. These repairs do not
establish the cause of the historical termination-test stall.

Use the pinned Node 24.21.0 binary. Node tests parse all transformed SDK modules,
recover the exact original bytes by reversing the explicit adapter, execute the
actual installed complete-call/config-merge block against labelled doubles,
exercise await/error/receiver semantics, and
verify bounded atomic records and malformed inputs. Python tests preserve the
real disposable-child termination/escalation cases, now injecting failure at
the first post-spawn fsync (after the additional directory sync). Package tests
check exact helper bytes in the complete runtime inventory. Actual Linux
instrumented startup, real readiness and any new paid launch remain pending.


### Explicit Sepolia ordinary and debug providers

The bootstrap now sets `ETHEREUM_HOSTS=https://sepolia.gateway.tenderly.co`
for ordinary reads, historical logs and the blob client's L1 checks, and
`ETHEREUM_DEBUG_HOSTS=https://ethereum-sepolia-rpc.publicnode.com` for the
archiver's debug client. Each list contains exactly one endpoint; neither is a
fallback. Beacon sourcing, `ETHEREUM_ALLOW_NO_DEBUG_HOSTS=false`,
`BLOB_ALLOW_EMPTY_SOURCES=false`, real proofs, isolation and shutdown gates are
unchanged. The pinned archiver factory uses an explicit nonempty debug list
instead of its ordinary list.

This is a reversible engineering configuration, supported by the 12-stage Mac
SDK split-provider probe (`split-prerequisites-72e-live-1.json`) and all eight
installed/image module bindings, including
`archiver-six-image-equivalence-20261012.json`. PublicNode rejected the exact
historical log query with code 4444; Tenderly returned the required event but
failed the SDK trace checks alone. The explicit pair passed history, trace,
blob, network identity and canonical continuity checks. These observations do
not establish sustained free endpoint capacity or Linux node startup. The
prior failed commissioning receipts remain failures. A provider change must
repeat the complete prerequisite checks and changed Linux startup qualification;
reversal is a reviewed explicit configuration change, never automatic fallback.

The generated-unit and decoded-payload tests exercise this exact pair, including
realistic-sized synthetic capabilities. The strict 16,384-byte compressed user
data cap remains enforced. Every actual new capability/deadline combination
must be regenerated and measured before launch; historical near-limit payloads
are not reusable approval. Changing bootstrap bytes also requires a fresh
manifest-bound runtime archive. No new launch is authorized by this change.

### Explicit full configuration provider selection

Operator07 failed before completion of CLI `getL1Config`. The separately approved
`operator07-l1-config-live-1.json` reproduced HTTP429 from Tenderly during the
complete configuration reads after successful address collection. The next
`config-history-499-live-1.json` passed all11 phases: actual complete SDK
PublicNode configuration, Tenderly deployment history and both providers' chain
identity/common canonical anchor before and after. These are Mac prerequisites,
not retrospective success for07 or a Linux qualification.

The loader therefore changes exactly one SHA- and count-gated complete call:

```js
getL1Config(nodeConfig.registryAddress,
  ['https://ethereum-sepolia-rpc.publicnode.com'],
  nodeConfig.l1ChainId, nodeConfig.rollupVersion)
```

This is our explicit runtime adapter using the official function's URL argument,
**not a stock SDK configuration flag**. Missing/duplicate call anchors, any
changed whole-module bytes, or an incompatible loaded module fail before module
execution. It does not edit installed SDK files, omit configuration fields,
mutate `nodeConfig.l1RpcUrls`, rotate providers, or retry a failed provider.
`ETHEREUM_HOSTS` stays Tenderly for ordinary/history/blob L1 reads and
`ETHEREUM_DEBUG_HOSTS` stays PublicNode for debug reads. Returned values and
genesis validation remain required. The updated helper digest binds this
adaptation in packaging and in the dedicated stage attestation. Future operator
receipt projectors must retain/validate the fixed `runtimeAdapter` field.

Factory, epoch-cache and archiver still make parallel ordinary reads on Tenderly;
this change has **not** established their sustained capacity. Real native Linux
startup/readiness, strict trace/blob/history verification and query qualification
remain release gates. No deployment, package build or paid launch is authorized
by this source change. A future package needs a fresh complete manifest and
actual <=16384-byte payload check, while all shutdown/masking/isolation controls
remain unchanged. Reversal requires a reviewed explicit provider choice and new
helper/package pins, never automatic fallback.


### Archiver progress observations (schema 2)

The failed operator08 receipt established completed configuration, genesis,
world-state and AVM setup but only the beginning of `factory-archiver`. It did
not distinguish an active historical backlog from a pre-loop wait or errors
caught by the SDK's existing polling loop. Schema 2 adds ten fixed subphases:
store creation, protocol registration, constants, initial header, archiver start,
blob/clock/trace/history checks and initial synchronization. Begin/complete
markers remain around the actual awaited operations and retain all source
conditions and returned values. The exact `Archiver.sync` body is observed with
a catch that rethrows the identical error; the existing `RunningPromise` error
handler, retries, timing and blob behavior are unchanged.

The additional `archiver` snapshot retains started/completed/failed pass counts,
in-flight state, latest observed L1 head, committed local L1 height, last
persisted checkpoint, monotonic elapsed observation/progress times and the last
bounded error category. Counters, times and heights are uint32; a larger or
invalid height increases a bounded dropped-observation counter instead of being
rounded. Error inspection is limited to eight typed causes, own data properties,
HTTP status 100–599 and signed 32-bit RPC codes. Accessors, cycles and unrecognized
errors produce fixed `unknown` information; messages, URLs, stacks and response
bodies are never recorded. A previous failure remains visible after a later
successful pass. A heartbeat never invents progress.

Progress snapshots are written at most once per 30 seconds, with additional
forced writes for finite stage transitions and normal process exit. The pinned
CLI's SIGTERM/SIGINT handlers call `process.exit`, allowing this final flush;
SIGKILL, power loss or an early unhandled signal can retain only the most recent
snapshot. No new signal handler changes the SDK lifecycle. An unfinished
`.stages.tmp` or sticky `.stages.failed` marker makes the Python/JS projection
unavailable, preventing an older valid record from concealing a known write
failure. If the filesystem cannot persist even the failure marker, durable
failure evidence cannot be guaranteed; shutdown controls remain independent.

The same 8192-byte cap, owner-only directory/file and exact helper digest apply.
Python and JavaScript both reject unknown keys, malformed numbers, incoherent
pass counts, old schemas and invalid stage nesting. Ordinary stdout can never
supply this record. These fields describe a trusted, explicitly instrumented
runtime, not a malicious-process attestation, anonymity result or readiness
pass. No observation alters timeout or release gates.

All six instrumented modules and the standby module were extracted from the
exact rc3 image and matched the installed rc3 source bytes. This includes
`archiver/dest/modules/l1_synchronizer.js`. Static byte equality is not execution
qualification; the existing unsuppressed compiler diagnostic hold is also unchanged. A future operator receipt projector must validate and
retain schema 2 and its finite `archiver` snapshot, including the unchanged
`runtimeAdapter: "publicnode-config-v1"` label. New packaging, an actual
<=16384-byte capability payload check and independent review remain prerequisites
for a separately authorized run. This source change does not extend a runtime,
rotate providers, retry a campaign or establish Linux qualification.

### Closed native version diagnostic (source only until separately authorized)

`bootstrap.py --native-version-only --config PRIVATE_CONFIG --output PRIVATE_GZIP`
selects a separate, closed diagnostic. Ordinary generation and packaging still
require the active Linux qualification pin; this mode neither supplies that pin
nor qualifies a node, query service or proof workload. No Node, Docker, CRS,
wallet, provider configuration, proof job or inbound service is installed.

Its exact JSON fields are `mode: "native-version-only"`, `createdAt`,
`budgetStop` (creation plus 45 minutes), `commissioningStop` (plus 30 minutes),
`binaryUrl`, `binarySha256`, `binaryBytes`, `expectedVersion`, and `receiptPutUrl`.
The only binary is the reviewed 44,698,432-byte Linux AMD64 rc.6 candidate with
SHA-256 `fa4b12adaefd5684b53b802346b9fe839ab3d6a4a829a5ea4efd6bd200e0829f`.
Its scoped HTTPS capability must point to the fixed private-bucket object
`releases/native-bb-<that-sha256>/bb`; redirects, proxy inheritance and alternate
hosts/keys are rejected. A successful raw download must match both length and
hash before executable permission is applied. Uploading this public binary,
reserving the complete cost envelope and creating a Fleet require separate
operator authorization; generation is not a launch grant.

The public generated runtime contains an explicit AST-selected subset of the
existing persistent deadline, egress, exclusive-record and receipt functions.
The full assembled runtime and worker bytes are hashed into its receipt. Tests
check this subset against the original functions and its complete global-name
closure. It is not an inferred source extraction or a general command runner.
For the reused immutable deadline record only, `runtimeArchiveSha256` identifies
the binary and `manifestSha256` identifies the diagnostic control source; these
are not claims of an ordinary release manifest or runtime archive.

The operator must first verify a request Fleet's exact absolute `ValidUntil`
and `TerminateInstancesWithExpiration=true`, encrypted root-volume deletion,
no IAM role or inbound access, and the existing single-attempt journal. Host
bootstrap independently installs and checks both persistent shutdown timers and
the 50 Mbps host ceiling **before downloading**. The configured root-only PUT
capability is never passed to the version unit or its environment. Reboot or
unknown-result replay encounters retained exclusive intents and fails closed.

The fixed unprivileged systemd unit runs only `bb --version`: 15-second capture,
512 MiB memory, two CPU quota, no network, read-only system, no private bootstrap
or cloud-init directory access, and no restart. Its enclosing 20-second unit
limit allows bounded capture/reaping; the absolute cloud/host deadlines remain
independent. Each output stream retains at most 8 KiB in memory and only its
byte count, digest and truncation flag in evidence. No native stdout/stderr,
arbitrary exception, capability URL or configuration is published.

The bootstrap retains `umask 077`. After exclusively creating the public-only
`/opt/rolling-native-version` directory, it explicitly sets that directory to
0755 through a no-follow directory descriptor before downloading or starting
the unit. This permits the dynamic user to traverse to the public 0444 capture
script and verified 0555 binary. Private directories remain 0700; capabilities
and journals remain private. An existing directory or permission-setting failure
halts this invocation and retains the final shutdown path.

The first native diagnostic observed systemd exit status 2 with no worker result.
Its source created this directory as 0700 under the inherited mask, reproduced
on the local filesystem. That is a concrete access defect consistent with the
receipt; absent historical remote modes/stderr, it does not prove the exact
historical exit cause or qualify the binary. Local mode tests do not substitute
for a separately authorized native execution.

The root observer records bounded systemd state **before cleanup**, with distinct
`transport-error` and `projection-error` statuses. Version outcomes distinguish
`started`, `timeout`, `nonzero`, `signal`, `oom`, `state-unreadable`, `passed`, and
`unqualified`; precondition or I/O failures remain separate. A passing result
requires an observed successful unit plus the reaped binary's exact version.
The durable final receipt is at `/var/lib/rolling-bootstrap/native-final.json`;
the upload intent/result stay private. A synchronous console marker and one
scoped PUT follow persistence. Shutdown is attempted in a `finally` path even
if persistence or publication fails. Independent timers remain the last resort;
missing evidence never authorizes another launch or execution.

Actual native AMD64 execution, receipt transport, resource readback and cleanup
must be independently reviewed before any active Linux pin is changed. Local
labelled doubles and payload roundtrips do not satisfy that gate.

The closed mode now also observes guest prerequisites after shutdown controls
are verified and before downloading the binary. Its receipt contains only finite
architecture, libc version, loader-presence, OS and CPU fields. The source reads
fixed `/proc/cpuinfo` (64 KiB maximum) and `/usr/lib/os-release` (4 KiB maximum),
and captures fixed `/usr/bin/getconf GNU_LIBC_VERSION` for at most three seconds
and 256 bytes. `/usr/lib/os-release` avoids Ubuntu's ordinary `/etc/os-release`
symlink without loosening a no-follow file guard.

Execution requires observed x86_64, the fixed executable ELF interpreter,
glibc >=2.34 (the candidate's retained ELF requirement), Ubuntu24.04 and two AMD
processors matching the intended m7a.large. Only the intersection of six fixed
CPU flags is reported; these flags are facts, not invented binary ISA gates.
Missing/malformed/truncated inputs, command transport failure or mismatches
remain explicit and block execution. No raw host text, arbitrary vendor/version
string, environment, process argument or URL enters the receipt. The operator
must validate this object and its new control-source hash before accepting a
passing version receipt. This does not replace later genuine native proof tests.

The native-only mode retains execution metadata across `systemctl start --wait`
and the separate state read. A fixed drop-in declares
`Before=rolling-native-version.service` on the **already-active** budget timer.
Systemd file ordering dependencies retain the referenced unit; this direction
follows the ordinary timer-before-service order. It adds no `Wants`, `Requires`,
start/restart or stop propagation, and changes neither absolute shutdown time.
After reloading, both timers must still be active and bounded ordering readbacks
must show the incoming reference and no reverse edge before the binary starts.
The version unit, `--wait`, strict exit/start-timestamp predicates, final shutdown
and ordinary Linux qualification gate remain unchanged.

Campaign2707 observed an independently reaped zero-exit matching version, but its
later systemd read showed zero execution fields. The unchanged gate rejected it.
Systemd's documented collection of inactive unreferenced units explains how such
state can be lost; the historical collection itself was not captured. This
reference repair requires an actual harmless Linux systemd lifecycle regression
before another paid version attempt. Local transport doubles are not that proof.
`RemainAfterExit=yes` alone is unsuitable because `--wait` would not complete;
`CollectMode=inactive` is already the default and permits successful collection.
# Explicit loopback prover activation

Commissioning remains query-only. It needs no fabricated Rolling/FPC/Bok addresses
and never starts a proof worker or public proxy. After the exact Linux query
qualification passes, a separately authorized root operator can invoke:

```
/usr/bin/python3 /usr/local/lib/rolling-attest.py --activate-prover <scope-file-sha256>
```

This is a single attempt, not a restart or recovery API. The fixed root-private
directory `/var/lib/rolling-bootstrap-private` must contain owner-root, mode0600
`prover-activation-scope.json` and `prover-deployment-evidence.json`. Its mode stays
0700. The scope has only the fields accepted by `activation_record`: exact release
manifest/catalog/network, three distinct contract addresses, expected board
deployer and Bok owner/operator, portal address, canonical L2 checkpoint, and the
SHA256 of the independently reviewed deployment receipt. The receipt must bind
that complete scope, four actual release artifact hashes, and positive constructor,
canonical FPC, portal-runtime, Ready and canonical-anchor checks. An opaque hash
or a successful old deployment is insufficient.

Activation verifies the packaged source before loading its fixed code. It checks
the immutable final query receipt, release/native/catalog integrity and unchanged
shutdown controls, then reads the current node with its real-proof and 120-second
L1 synchronization policy. SDK-derived class and instance identities, deployers,
board/Bok public configuration, canonical FPC, portal runtime/immutables and active
Ready state must match. The portal reads use the one fixed public Tenderly Sepolia
endpoint with bounded responses, no redirect, retry, fallback, signer or wallet.
Both L1 and L2 anchors are rechecked. Captured public scope scalars cannot change
during asynchronous checks. A minimum fifteen minutes must remain on the existing
absolute budget; activation never extends it.

The durable activation intent precedes account creation, UID rules, unmasking and
starting the existing service. An existing intent or result rejects a new attempt.
The dedicated nologin user receives read-only access to manifest-verified public
release bytes. The complete release tree and parent traversal are validated before
creating that user or changing ownership. Manifest-verified internal relative
links to regular files (including official Node npm/npx/corepack links) are kept;
absolute, escaping, dangling, directory and looping links fail closed. Link
ownership uses no-follow, links are never chmodded, and their inventoried regular
targets receive the same read-only permissions as other public files.
`/etc/board-prover` is root:board-prover0750 and its fixed generated
configuration is root:board-prover0640. Capabilities, admin keys, cloud data and
operator journals retain their original private modes and are not copied into the
service configuration. The unchanged unit keeps its 24GiB ceiling, one active
worker, no restart and existing bounded worker lifetime.

Both IPv4 and IPv6 owner rules must set mark20. Fixed loopback UDP exercises must
advance each rule's packet counter, and the actual fw classifier must map mark20
to class1:20 under the unchanged whole-host 50Mbps ceiling. The readback accepts
only an optional normal fw header and one all-protocol, preference1, chain0
mapping detail (including the equivalent omitted default chain notation). Wrong
handles, classes, families, duplicate rows and unknown fields fail closed. This verifies rule
execution and classifier configuration; it is not an external throughput test.
Unexpected existing mangle policy fails closed. The proxy remains masked, the
service listens only on127.0.0.1:8081, and origins are empty.

The operation has a 300-second alarm, bounded subprocesses and a bounded health
wait. Failure attempts service termination and the existing host shutdown even
when persistence fails. An ambiguous start is not replayed. The attestor verifies
the active unit, live UID/GID, configuration owner/modes/hash, traffic controls and
fresh query health. It reports activation in progress or active-loopback truthfully
instead of continuing to claim the service is masked. Drift shuts down the host.

An active loopback service is **not** application-proof qualification, public
routing authorization or permission to submit a proof job. Bok is explicitly
`constructor-allowlist-only`; portal credit/service flows require their own
acceptance. No application transaction, deployment or key-management operation is
performed by activation. Operator/Fleet grants, current deployed scope and actual
Linux activation acceptance remain separate gates.

# Optional authenticated operator query host

An explicit `queryHost` object adds only `privateAddress` (an assigned RFC1918
IPv4), `operatorAuthSha256` (64 lowercase hex characters), and
`originSecurityGroupId` (the independently verified CloudFront VPC-origin
service-managed security group). The digest verifies a fresh local operator key;
the key, wallet, AWS credentials and receipt capabilities never enter service
configuration. The security-group field is a campaign binding, **not** a claim
that Linux has verified AWS ingress rules. Before enabling the route, the trusted
operator must read back the actual origin HTTP port8083 and ingress restricted
to that managed group. Viewer HTTPS does not establish origin isolation.

After the immutable query qualification passes, the existing root attestor makes
one durable query-host intent, creates `rolling-query`, and starts a fixed
`rolling-query.service` from the verified public release. It listens on only the
bound private address:8083. It runs the existing query-only composition with zero
proof resources, empty origins and mandatory authentication. Only POST `/v1/node`
is admitted; health, jobs, admin and compact paths remain unavailable. `sendTx`
is included in the fixed operator method policy, so this is not a read-only API.
No raw node/admin port is exposed. Prover and proxy remain masked.

The service has no restart, a30-second stop/drain bound,2GiB memory ceiling,
128-task limit, no capabilities, inaccessible root-private paths and no public
network egress. Its fresh readiness inspector independently reads only the
loopback node under the existing real-proof/testnet identity and120-second
freshness policy. Local listener probes must reject unauthenticated calls; they
are not positive authenticated-operation qualification. Actual CLI/PXE integration
and deployed TLS/SG/route tests remain required. Local development uses native
devnet proofs disabled; this campaign gate remains testnet acceptance.

Only verified public runtime bytes use the `rolling-runtime` reader group.
Directories/executables are0550, other regular files0440; internal regular-file
links remain validated and receive no-follow ownership only. The dedicated query
config is root:rolling-query0640 under0750. Later prover activation adds only its
own account to the public reader group and preserves that group on the release;
private config/capability paths keep their separate groups and0700/0600 boundary.
Existing identity/link/traversal prevalidation and activation once-only gates stay.

Every observation checks actual unit/config/process identities, shared-reader
permissions and fresh upstream readiness. Missing result after an intent is
reconcile-only; drift or setup failure stops the query unit and invokes the
existing shutdown owner. Attestor timeout also triggers that owner. Neither the
host nor Fleet deadline is extended. This slice does not implement the separately
reviewed finite S3 activation delivery, current contract deployments, public proof
routing or proof-job acceptance. Complete package and compressed user-data size
must be requalified before deployment; source preparation alone is not a payload.

Query-host opt-in is bound into the immutable bootstrap pins. After installation, missing request/intent/result state fails closed rather than disabling observation. Runtime supplementary groups must be unique decimal IDs limited to the query primary group and public runtime group, with the public group present. The final qualification receipt is hash-bound in the once-only query intent. Focused development tests use real owned filesystem modes and explicitly simulated root identities/systemd state; actual Linux commissioning remains required.

## Finite post-commissioning activation delivery

The optional private bootstrap field `activationDelivery` closes the delivery
step described above. It contains exactly `campaign`, `getUrl` and
`scopeBindingSha256`. `campaign` is a fresh 1–80 character letters/digits/underscore/
hyphen identifier. `getUrl` is a SigV4 GET capability for exactly
`https://anonymous-message-board-testnet-backups-nvdhcyurtoga.s3.eu-west-2.amazonaws.com/receipts/CAMPAIGN/activation.json`.
It must remain valid through the existing `budgetStop`; it grants no upload,
listing or host IAM authority. Keep the URL in the private payload and never
print it. It is an authenticated fixed-object delivery capability, **not** an
independent offline signature over future deployment evidence. The existing
trusted AWS operator is the authorized publisher of that one campaign object.

Before launch, compute `scopeBindingSha256` with the source helper
`activation_delivery_digest(activation_delivery_scope(scope))`. This commits to
all fixed fields accepted by `activation_record`, including schema, release
manifest/catalog, chain/rollup, contract addresses, actors and portal. Only
`checkpointNumber`, `checkpointHash` and `deploymentEvidenceSha256` are omitted
from this commitment: they are supplied by the eventual actual deployment.
Deterministic addresses must be prepared through existing deployment APIs; an
address commitment does not itself establish deployment or readiness.

After genuine testnet deployment and finality, the trusted operator publishes
one JSON envelope with exactly:

```
{schemaVersion: 1, campaign: CAMPAIGN, scope: EXISTING_ACTIVATION_SCOPE,
 evidence: EXISTING_DEPLOYMENT_EVIDENCE}
```

Use the existing `activation_record` and `activation_evidence` schemas. Compute
`scope.deploymentEvidenceSha256` over the UTF-8 bytes of
`json.dumps(evidence, separators=(',', ':'))`, preserving insertion order; the
consumer writes those same bytes. The whole envelope is at most 16 KiB. Retain its
bytes/hash and S3 VersionId with the deployment receipt. The trusted existing
campaign upload helper must persist intent before a single conditional
`If-None-Match: *` upload. An uncertain upload is reconciled by the original key,
version and bytes; it is not uploaded again or replaced with another scope.
This component performs no upload or cloud mutation.

The existing root attestor reads only after its final Linux query receipt passes.
Its first qualified visit records a fixed window ending at the earlier of 30 minutes
or `budgetStop` minus 15 minutes. There are at most 60 GET attempts, spaced at least
30 seconds apart; each read has an 8-second wall deadline and 16 KiB byte cap. A 404 is
pending only within that window. Redirects, other HTTP errors, missing version
identity, malformed/duplicate fields, mismatched scope or lost attempt records
fail closed. Existing attestor cadence, 100-second service timeout, independent
host/Fleet shutdown and all qualification/control checks remain unchanged.
Consequently an activation that cannot finish within that existing outer owner
fails closed; the delivery mechanism never extends the activation budget.

Each attempt and pending result is an exclusive fsynced root-private record.
The existing window record also persists the high-water count before each read;
missing even a complete last attempt/result pair cannot lower the count. A
partial counter write fails closed rather than resetting it.
Before staging either activation input, the attestor exclusively retains the
chosen object version, body hash and exact scope-file hash. It then calls the
existing once-only activation, which independently rechecks live identity,
canonical anchors, artifact/constructor/Ready/FPC evidence and remaining budget
before recording activation intent and starting the service. An interrupted
read, consumption, staging or activation is reconciliation-only. A subsequent
visit observes a completed activation; it never fetches or activates again.
Missing request/qualification/consumption records cannot silently opt out of
monitoring. Failure still stops the owned units and requests the budget shutdown.

The fixed record readers and packaged source interpret this envelope; no URL,
command, executable, wallet key or administrator credential comes from it.
`init`, `set_portal` and other operator deployment methods remain excluded from
the consumer proving profile. Genuine testnet deployment uses the existing
trusted operator native prover path, whose actual proof/runtime qualification is
a separate prerequisite. Current testnet deployment, CloudFront query-route
operation/readback, real Linux delivery/activation, fresh payload measurement
with actual capability lengths, and real-proof acceptance remain unperformed by
these controlled tests. Do not launch the proposed $39 campaign before those
preparation steps and the fresh forecast are ready.
