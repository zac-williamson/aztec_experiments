# Rolling application releases

This is the small **same-contract application** release lane. It builds the
current wallet assets, serves a separate staging site, exercises actual testnet
onboarding and posting, and switches the deployed application to those exact
files only when the journey passes. The existing `build.yml` remains the full
build prerequisite. It does not deploy contracts, a node, a prover or a Bok worker.

## What the gate checks

1. GitHub's full build passed for the exact current `master` SHA. Pull requests
   run focused checks on GitHub-hosted runners without infrastructure secrets.
2. Contract, prover, dependency and pinned build changes fail closed. The normal
   application lane reuses installed compatible contract/SDK/CRS artifacts and
   dependencies, then runs the real `rolling-wallet-assets.mjs` builder.
3. Every candidate file has a SHA-256 inventory. Staging serves the exact public
   asset bytes, a real-proof Sepolia runtime and a ready reader of the same board.
4. Playwright creates two fresh wallets, funds them from a dedicated test faucet
   account, and uses the actual wallet UI for ETH and USDC account creation. The USDC
   wallet receives no ETH; its balance is checked before and after gasless signup
   and the injected wallet refuses gas-bearing sends. It
   posts, replies, likes, reloads, buys Bok credit and waits for Bok's reply.
   The installed native event decoder independently binds submitted transactions
   to the canonical node receipt, archive block, effect, Board class and actual
   events. Post text/parent/root, a real like and the precise Bok request/reply
   must match. This uses the application's proposed-or-later inclusion tier,
   and rechecks those transaction anchors at the end. It does not claim L1
   finality or run a network prover.
5. The candidate and current baseline are rehashed before promotion. The live
   pointer changes atomically; the service restarts; runtime/API and exact public
   bytes are checked. Failure restores and verifies the previous application.

No external JSON receipt or user-supplied command can mark the testnet gate
passed. The browser driver and native verifier run from the root-owned operator
installation, independently of the candidate. Contract changes use the separate
qualified deployment process, then establish a new baseline; application rollback
does not undo contracts, node state or external worker changes.

## Current application checks and the legacy prototype

The required `Pinned build and baseline checks` workflow includes the current
private-credit reader/payment tests, account-status balance tests, deployment
registration binding tests and the full Rolling application tests. The separate
credential-free focused gate also checks deployment registration; SDK-dependent
credit/account tests run after the normal full build has produced its artifacts.
Full build, generated-byte reproducibility, artifact checks, contract tests and
the actual staged testnet journey remain release prerequisites.

`Legacy fee-juice prototype checks` keeps
`scripts/test-private-fee-funding-engine.mjs` visible on manual runs and changes to
the standalone prototype, its check, or the shared fee implementation. That test
exercises `apps/src/fee-juice/engine.js`, which is outside the deployed Rolling
routes. The prototype's `balance_of` call is incompatible with the current
PrivateFPC artifact; its two balance checks fail and the separate job reports
those failures normally, without
`continue-on-error`. It does not trigger or authorize a Rolling release. The
legacy test and prototype code remain intact; this split makes no claim that
those prototype failures are repaired.

## One-time host setup

Do this after the active contract release finishes. The integrating operator owns
these host and GitHub changes; unit tests do not perform them. Reuse the existing
host, node and prover to stay within the launch budget.

- Use GitHub-hosted jobs only. This repository is public; no persistent GitHub
  runner is registered on the application host. Create the `rolling-release`
  service account with home `/var/lib/rolling-release-job` and no membership in
  `sudo`, `wheel`, `admin`, `docker` or `lxd`. The fixed systemd job runs under
  this user only when invoked; it stores no GitHub token or cloud credential.
- Restrict GitHub environment `rolling-testnet-release` to the exact `master`
  branch. This environment policy is essential: the OIDC subject contains the
  environment, not a branch claim. Protect master from unreviewed changes.
  Review and provision `oidc-template.json` in us-east-1 with
  `CAPABILITY_NAMED_IAM`; it creates the GitHub OIDC provider (only if absent),
  one role and one parameterless SSM command on the existing core instance.
  Set environment variable `ROLLING_RELEASE_ROLE_ARN` to its role ARN. No new
  machine is created. The role can only submit this fixed document to this
  instance and read invocation status. It cannot change documents, units, IAM,
  source references or commands. The workflow pins document version1.
- Install the pinned Node version in `toolchain.json`. The shared `node_modules`
  tree must be root-owned, unwritable by group/others, and installed from the
  same lockfile with the repository's pinned patch/build process. It must include
  Playwright and its Chromium browser installation at the root-owned
  `/opt/rolling-ci-bootstrap/browsers` (`PLAYWRIGHT_BROWSERS_PATH`).
  The installer checks dependency ownership and the Node version.
- Run the application under a separate non-root service account. Create
  `/opt/rolling-releases`, `/opt/rolling-stage/current` and
  `/opt/rolling-release-live/current` (the last two are symlinks). Only the release user
  writes the release directory and symlink parent directories. Application
  services write their separate cache/state directories, never release files.
- `rolling-staging.service` runs:

      WorkingDirectory=/opt/rolling-stage/current
      ExecStart=/opt/rolling-ops/runtime/node apps/rolling/start.mjs /etc/rolling-stage/public.json /etc/rolling-stage/wallet.json /etc/rolling-stage/relay.json

  Use `deploy/launch-ops/rolling-staging.service` as the bootstrap support unit.
  It copies the systemd credential into its private runtime directory with mode
  `0600` before starting. The relay config uses
  `/run/rolling-staging/relay-signer.json`; systemd's own credential mount may be
  `0440`, which the relay correctly rejects. The persistent source remains root-only.

  The live unit is exactly `rolling-application.service`, uses
  `/opt/rolling-release-live/current`, and the existing live config files. Give
  `rolling-release` passwordless sudo for only these two exact commands:
  `/usr/bin/systemctl restart rolling-staging.service` and
  `/usr/bin/systemctl restart rolling-application.service`.
- Stage uses a separate origin, port `8091`, public-index/saved-items directory,
  funding relay database and test credentials. It may share the current testnet
  contracts, node and prover. Its wallet config must have `proofsEnabled: true`.
  Use a separate CloudFront distribution whose origin path is `/_stage`, with
  Caddy stripping that prefix and proxying all app paths to `8091`.
  Live app paths must resolve through the live application release pointer too.
  Serving static files from a separate old UI directory will correctly fail the
  byte check. Keep `/wallet/*`, `/crs/*`, `/api/*` and the actual backend available
  on the stage origin. Analytics collection must be disabled on staging.

Prepare a sanitized baseline runtime under
`/opt/rolling-releases/<full-source-sha>` using the exact deployed source and
generated assets. It contains no `.git`, private configuration, databases, logs,
or account material; `node_modules` links to the immutable dependency tree.
Required generated inputs are `.build/contracts-manifest.json`, `.build/sdk`,
`.build/owner-delivery` (the pinned embedded Noir sources),
`.build/rolling-wallet` (including registration and manifest),
`billboard/target/rolling_contract-RollingBoard.json`,
`apps/src/billboard/private_fee_artifact.json`, `experiments/private-bok/target`
and `apps/dist/crs`. All wallet manifest source inputs must also exist and match.
The deployed source revision must be accurate; do not relabel an old UI release.

Seal that baseline against the actual deployed origin:

    node scripts/release/seal-current.mjs /opt/rolling-releases/FULL_SHA FULL_SHA https://rolling.chat

This verifies wallet inputs, actual public bytes, current contract identity and
the reader. It never switches a service. After success the operator can adopt
this directory as the live pointer and start staging from the same baseline.

Create `/etc/rolling-release/config.json`, mode `0600`, owned by the release user:

```json
{
  "schemaVersion": 1,
  "stagingOrigin": "https://YOUR-STAGING-DISTRIBUTION.cloudfront.net",
  "liveOrigin": "https://rolling.chat",
  "stagingLink": "/opt/rolling-stage/current",
  "liveLink": "/opt/rolling-release-live/current",
  "releaseDirectory": "/opt/rolling-releases",
  "stateFile": "/var/lib/rolling-release-state/state.json",
  "walletFile": "/etc/rolling-release/test-wallet.json",
  "publicFile": "/etc/rolling-release/public-verifier.json",
  "nodeBinary": "/opt/rolling-ops/runtime/node",
  "stagingService": "rolling-staging.service",
  "liveService": "rolling-application.service"
}
```

Start from `test-wallet.example.json`, refresh its allocation against the current
quote, and supply only the dedicated test key locally. Create private
`test-wallet.json` with exactly these fields: `stagingOrigin`,
`liveOrigin` (same as above), `ethereumRpc` (Sepolia), `testFunderKey` (a dedicated
test-only key), `ethPerAccountWei` (decimal string, at most `500000000000000000`),
`usdcPerAccount` (decimal string, at most `100000000` test-USDC base units),
`timeoutMs` (`540000` maximum), and `testOnly: true`. Owner `rolling-release`,
mode `0600`. Keep it out of GitHub, artifacts and logs. Fund it with free Sepolia
ETH and the deployed router's test USDC. Each run creates two disposable accounts;
it never imports a user's account and rejects any chain other than Sepolia.
Disposable balances are not recovered or retained as fixtures.
The ETH allowance applies only to the fresh ETH-payment wallet; the USDC wallet
still receives zero ETH. Up to0.5 free Sepolia ETH is allocated to the ETH-payment wallet per run,
with100 test
USDC for the separate gasless signup. This is a ceiling, not a target: set the
actual allocation from a fresh route quote plus the remaining journey cost.
The28 October quote required about0.389214 ETH for signup because of the current
Sepolia fee-token pool, so the previous0.01 ceiling could not exercise this path.
Dedicated funder transaction gas and the relay gas budget are additional.
The chain11155111 restriction, contract target allowlist, cumulative signing cap,
zero-ETH gasless check and relay's separate gas budget remain enforced. No
mainnet funds or paid token acquisition are introduced by this fixture policy.


Install the reviewed operator code and fixed wrappers once, as root:

    node scripts/release/install.mjs /etc/rolling-release/config.json

The installer refuses to overwrite an existing installation. Gate changes require
an explicit reviewed operator update; deploying application source never replaces
the privileged gate. Set the state directory's group so the private monitoring
service can read `release-state.json` (mode `0640`). The dashboard should display
only status, source revisions, timestamps, stage names and the error enum.

After preparing the stopped stage service, reload systemd so its non-root user
is visible, then install the fixed release job as root:

    node scripts/release/install-job.mjs /etc/rolling-release/config.json

This writes `rolling-release-job.service` and the two exact sudo permissions. It
never starts or enables a service. The unit has no automatic startup target. It
uses a root-owned `host-job.mjs` which fetches only the fixed public repository's
current master. Git hooks, credential helpers and non-HTTPS Git protocols are
disabled. The job independently checks public GitHub's full build result for that
exact commit; a newer failed/incomplete run blocks it. No passed receipt, source
archive, command or revision can be supplied by the caller. A manual workflow
request checks the current master too; it does not deploy an old trigger SHA.

The job is bounded to 8GiB memory, two CPU cores and512 tasks on the shared
host. Confirm those limits fit the host before installation. Its filesystem is read-only except its own checkout, releases, pointers and
sanitized-state directory. Service configs and state, cloud-init data and home
directories are inaccessible. Both EC2 metadata addresses are denied. AWS
credential variables are removed and credential files point to `/dev/null`.
The startup preflight checks that no AWS credentials are present and metadata TCP
access fails without requesting credentials. The two fixed sudo restarts require
`NoNewPrivileges` to remain off; both application services must use separate
non-root accounts. No repository code runs as root.

Install Chromium from the pinned shared Playwright package into the root-owned
browser directory, including its OS libraries. Install only dedicated capped
Sepolia test funder and stage relay keys; coordinate their initial funding with
the operator of the shared signer. Never copy that shared key to this job.

After final baseline adoption and staging smoke, create root-owned mode0644
`/etc/rolling-release/enabled` to allow the fixed SSM document. Keep that marker
absent until final contract acceptance and fixtures are ready. A one-shot run
then executes the actual stage journey; failed full builds remain blocked.
GitHub logs show only invocation status, never host output or private fixtures.
Inspect the private dashboard and host journal for sanitized failure enums.

The current journey targets the paid-like release: a post must emit `PostTipKey`,
the UI must offer `Like · 20 credits`, and the independently decoded transaction
must contain its successful `LikeChanged` event. The pinned Board/FPC classes
enforce the payment. Install the verifier from the same final tipping source
baseline; the older pre-tipping decoder is incompatible. Do not bootstrap the
old 635a33b3 release after the tipping contract deployment.

## Operating it

A successful full build on `master` triggers the release workflow. Manual
dispatch on `master` uses the same full-build check and real journey. The workflow
is not operational until the OIDC trigger, installed job, baseline, stage
services, private test fixture and GitHub environment are installed and exercised.

- Staging failure: live remains unchanged. Fix the cause and rerun. The same SHA
  reuses a complete verified candidate; a partial build stays in a uniquely named
  `.preparing-*` directory and cannot be promoted. Remove abandoned preparations
  only after confirming no release process owns them.
- Live smoke failure: `rolled-back` means old bytes and runtime/API were verified.
  `rollback-failed` requires an operator immediately.
- Explicit same-contract rollback:

      /usr/local/bin/rolling-release-rollback /opt/rolling-releases/PREVIOUS_FULL_SHA

- A terminated process can leave `release-state.json.lock`. Confirm no release
  or rollback process is running and inspect the actual live symlink before
  removing a stale lock. Never clear it just because another workflow is waiting.
- External deployments must serialize with this lane and establish a new sealed
  baseline. A changed live pointer during staging blocks promotion.

Staging's browser events are excluded from analytics. Because this economical
setup shares the public testnet board, synthetic posts, replies and likes are
still public board activity and count in community totals. The `Release check`
prefix makes them recognisable. Do not create persistent visitor identities to
filter them. A separately deployed stage Board gives clean separation if needed.

## Verification recorded for this change

`node scripts/release/checks.mjs` exercises real local filesystem swaps and HTTP
asset checks, failure blocking, concurrent release exclusion, rollback failure,
same-SHA retry and runtime/config identity checks, plus focused current reader,
anonymous analytics, operator authentication, collector, capacity and backup
checks. Python checks cover privacy projections, the bounded cloud adapter and
deployment configuration validation. They use local disposable fixtures and no
cloud credentials or dependency install. These are local component checks;
the full pinned build and actual testnet journey remain separate release gates.
The browser journey and host installation require the first actual staging run
after the active contract release finishes. No testnet success is claimed from
a green unit suite or a generated manifest.

## Concrete bootstrap payload

`bootstrap.py` verifies a fingerprinted application-source archive and operator
archive, compares the exact declared source with the final deployed runtime, and
prepares a stopped stage service and operator installation. Its default mode is
a payload preview; `--apply` requires final live config hashes and an explicit
dedicated stage relay address. It never switches a live unit, changes Caddy,
starts a service, registers a runner or reads a shared signer.

Use a dedicated stage relay signer and separate state. `seal-current.mjs` accepts
an optional fifth argument naming the stage wallet config. It pins the stage
runtime separately, admitting only the relay address and endpoint-host differences
from live. All contract identities, code hashes and funding/gas policy stay bound.
The release job reads `/etc/rolling-release/public-verifier.json`, a non-secret copy of
node URL, scope and immutable verifier artifact paths; all service configs are
explicitly inaccessible inside the release job.

The state parent is `/var/lib/rolling-release-state`, owned
`rolling-release:rolling-ops` with mode2750 so mode0640 output is readable by the
dashboard without giving the release job access to analytics storage. A 3GiB reserve
blocks new candidate builds. The optional root prune timer only removes sealed
releases predating the last successful promotion, under the deployment lock, and
keeps actual live/stage targets and the previous successful release. Fresh
candidates and partial preparations are retained for explicit inspection.


## Preparing a coherent baseline across a split UI/backend publication

When UI source and its SDK have advanced beyond the active backend directory,
never label the older generated SDK with the newer revision. Use
`materialize-baseline.py --repo REPO --revision FULL_SHA --build RETAINED_BUILD
--output NEW_DIRECTORY`. It writes an exact Git source tree plus retained build
outputs, a sibling tar archive and proof inventory. Every recorded build input
must match the source revision or the pinned generated/dependency closure, and
SDK, wallet, CRS and committed frontend outputs are hashed. It makes no network
request, builds nothing and never claims deployment acceptance.

The SDK manifest includes public Solidity dependency sources. Exactly those
hash-pinned `.sol` files under the fixed L1-artifacts contracts directory are
included in the baseline and copied for later application candidates. Executable
nested npm packages remain rejected. Top-level installed dependencies are still
root-owned and every recorded SDK dependency hash must match on the host.

An operator may install the reviewed tree (without a node_modules link) as
`/opt/rolling-prepared/FULL_SHA` and its proof as the sibling `.proof.json`, all
root-owned and unwritable by other users. The application-source archive must
name the same exact commit. Set `preparedBaseline` to that directory and
`preparedBaselineProofSha256` to the reviewed proof hash in the bootstrap plan.
Keep `baselineRuntime` naming the actual active backend directory and preserve
its current configuration hashes. Bootstrap checks the active backend has not
changed, then verifies the prepared tree against both the proof and exact source
archive. It copies the prepared SDK/wallet outputs, never the old backend SDK.
The normal deployed-source equality path remains unchanged when these explicit
prepared inputs are absent.

Before either release pointer is created, sealing still requires the actual
public origin to serve every exact asset byte and a compatible real-proof
runtime and ready reader. Until the newer UI is published, that check fails.
This preparation never changes the live unit or Caddy. Adopting the coherent
backend and enabling the release trigger remain separate operator actions after
the current release's actual browser acceptance. A successful inventory check
or materialization is not that acceptance.
