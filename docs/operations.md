# Operations: public escrow observation

The initial monitor is a one-shot, read-only check of the Ethereum portal. It loads no wallet, signer, account database or private fee notes and submits no transaction. It is one part of operational readiness; it does not establish that the complete application is healthy.

From the repository root with the pinned Node 24 runtime and installed dependencies:

```sh
node deploy/operations-monitor.mjs /absolute/path/to/exported-public-board-config.json
```

Use the public board configuration exported by the application, verified against your deployment record. The monitor reuses its exact configuration validator and the installed `shared/portal-runtime.json` verifier. Keep the application checkout/runtime metadata from a trusted build; replacing both configuration and trusted build defeats these checks. No monitoring credentials or private keys belong in this file. The public endpoint validator rejects URL usernames, passwords and query credentials. Endpoint paths are never printed.

The command emits one JSON observation. Exit status 0 means balanced and active, 1 means surplus requiring investigation, and 2 means a critical or unavailable observation. Monitoring systems should alert on a missing scheduled observation as well as nonzero exits; an absent process cannot report its own failure. No scheduler or background service is installed by this command. An operator can invoke it periodically using existing infrastructure with overlapping runs disabled.

The monitor has a ten-second observation deadline and ten-second HTTP request timeout. All balance, liability, runtime and immutable reads use the same Ethereum block hash with `requireCanonical: true` (EIP-1898). A provider that lacks this facility fails closed; the monitor never silently switches to mixed latest-block reads. Each invocation checks:

- Ethereum chain ID; configured portal, board and rollup identities; portal rollup version and the rollup's current version; bridge inbox/outbox correspondence.
- Exact portal deployed bytecode against the local runtime template and actual immutable values.
- Portal `totalDeposited` liability, ETH balance and `depositsEnabled`, at the selected block.
- The block timestamp is at most 180 seconds old and no more than 30 seconds ahead of the monitor host's clock.

An exact runtime match authenticates the installed portal implementation relative to the trusted local build. It does not authenticate the RPC's honesty, cryptographically verify Ethereum, establish Aztec node health, prove the configured board class or private fee contract, or demonstrate public-network production suitability. The unchanged portal configuration hash is observed as an immutable, but this public config format contains no independently expected policy hash to compare. Preserve the deployment manifest separately. Keep the host clock synchronized.

| Code | Operator response |
|---|---|
| `ESCROW_BALANCED` | Continue monitoring. This is an escrow observation, not overall service readiness. |
| `ESCROW_SURPLUS` | Investigate the difference. Forced or unsolicited ETH can raise balance without raising credited deposits. Do not credit users for the surplus; the monitor does not establish its provenance or a recovery mechanism. |
| `ESCROW_DEFICIT` | Escalate immediately, preserve evidence and compare a second independently trusted endpoint. Stop advertising new deposits while investigating. Preserve withdrawal access; this command does not pause or alter the contract. |
| `PORTAL_INACTIVE` | Do not advertise deposits. Reconcile the existing activation procedure and deployment record. A simultaneous deficit takes priority in the emitted code. |
| `OBSERVATION_STALE` | Check clock, chain progress and endpoint lag. Do not label old balances as current. |
| `OBSERVATION_UNAVAILABLE` | Treat health as unknown. Check endpoint support/reachability and retry with a separately verified configuration using an alternate provider. No raw RPC errors are logged. |
| `IDENTITY_UNVERIFIED` | Stop trusting the selected endpoint/configuration. Compare chain, runtime, immutable and deployment records through a trusted channel. |
| `MONITOR_CONFIG_INVALID` | Check the input file and installed build. No supplied values or exception details are emitted. |

The output contains aggregate public escrow amounts, block number/time and fixed classifications only. It excludes addresses, URLs, raw error bodies, depositor-level data, private keys, message content and private note data. A second provider is a corroboration step, not a way to suppress the first alert. The monitor never changes configuration or retries a payment.

## Local injected-failure check

```sh
node --test scripts/test-operations-monitor.mjs
```

These inexpensive tests inject balanced/deficit/surplus state, stale and future timestamps, inactivity, transport failure and a hanging request. The RPC adapter tests encode actual ABI responses and reconstruct the installed runtime, verify hash-pinned reads, and reject wrong chain, board and bytecode. They are local test doubles: they are not a live deployment rehearsal or evidence of production availability.

## Work remaining before operational acceptance

- Add and exercise public feed lag and moderation-deadline monitoring against the daemon's actual durable state; confirm who receives and responds to each alert.
- Add privacy-preserving private-fee failure and transaction-outcome aggregation; an escrow balance says nothing about individual private fee funds. No central monitor should collect users' private balances or funding secrets.
- Exercise moderation signer availability and recovery without collecting credentials in logs; document supported authority rotation from actual contract capabilities rather than inventing an administrator pause/rotation feature.
- Rehearse RPC failover, deployment/activation reconciliation, wallet/private-fee recovery, credential replacement and rollback/exit limitations with disposable identities. Validate that client recovery retains pending transaction journals and does not resend unknown outcomes.
- Record historical exposed provider credentials by location/provider only, never by reproducing values; require operator replacement/restriction and named ownership.
- Integrate observation delivery and missing-run detection with the operator's chosen existing monitoring infrastructure, then rehearse alerts and acknowledgement. This document and these fixture tests do not satisfy the full operations acceptance package.

## Moderation health output

The existing daemon now emits a `billboard-moderation-health-v1` JSON summary after each cycle (inside its timestamped log line). It uses the existing SQLite job store; no new service or database is required. The summary exposes aggregate unsigned work, unresolved signing, manual signing fences, included transactions awaiting finality, expired obligations, manual attention, the last ingested checkpoint height, and time since successful ingestion.

Ingestion age is **not chain lag**: a healthy RPC can repeatedly return the same checkpoint. The separate bounded feed-lag observation below compares checkpointed L2 heights. Successful ingestion time is recorded atomically with the existing checkpoint, survives restart, and does not advance on a failed feed read. Old databases without that setting report `INGESTION_UNKNOWN` until their next successful ingestion.

`SIGNING_FENCED` requires inspection of the saved intent/journal before further signing. Never delete SQLite state or transaction journals to clear it. `SIGNING_UNRESOLVED` means an outcome remains unknown; `AWAITING_FINALITY` means a successful included receipt exists but final canonical completion remains outstanding. Benign unsigned already-flagged and superseded-model records are excluded from missed-work alerts. Expired/manual-review obligations remain visible even though they are terminal queue states. Dry-run violations still require manual attention and cannot report production completion.

Daemon cycle and fatal logs use fixed failure classifications; arbitrary caught error messages/codes are excluded. Investigate detailed durable state in a private operator session instead of exporting post text, decisions, transaction identities or credentials into alerts. Missing process/cycle output still requires external missing-run monitoring. Structured health does not itself deliver notifications or qualify a moderation model.

A `RETRYABLE_WORK_FAILED` warning reports failed evaluation/context work even when feed ingestion is fresh and its deadline is distant. Ordinary newly queued work alone does not trigger this warning. The monitor HTTP transport owns AbortControllers for every concurrent request and aborts actual network/body work when disposed after observation; it also caps each response at 1 MiB. Injected local-server tests verify hanging request sockets close, rather than merely testing a timeout against an inert promise.

## Authority handover and saved moderator recovery

The following are supported application commands, not evidence that the operational drill has been completed. Use disposable identities for the rehearsal. In a prepared operator package, replace the placeholders with already verified public configuration and private wallet file paths. Keep wallet files private (`0600`) and retain the existing daemon state directory, PXE state and transaction journals.

Stop the old daemon gracefully and preserve its state before handover. If any signing intent is unresolved, inspect and reconcile that exact saved operation first; rotating or deleting files does not establish that its transaction failed. Confirm that the successor account and its private fee funding are usable before transferring authority.

```sh
./scripts/operator-launch.sh author transfer-censor \
  --portal-address "$PORTAL" --node-url "$AZTEC_RPC" --eth-rpc "$ETH_RPC" \
  --censor-wallet "$CURRENT_CENSOR_WALLET" --private-fee-config "$FEE_CONFIG" \
  --new-censor "$SUCCESSOR_ADDRESS"
```

`transfer_censor` is a public function callable only by the current nonzero censor. The successor must be nonzero; there is no proposed/accepted handover handshake or lost-key override. A rollback requires the new censor to transfer authority back. Verify the resulting canonical transaction and current censor state before restarting moderation with the successor. This command does not pause deposits, change policy, or erase earlier deadlines. A lost current-censor key cannot be replaced by an administrator through this contract.

An intentional policy change uses the current censor and takes literal public text:

```sh
./scripts/operator-launch.sh author set-moderation-policy \
  --portal-address "$PORTAL" --node-url "$AZTEC_RPC" --eth-rpc "$ETH_RPC" \
  --censor-wallet "$CURRENT_CENSOR_WALLET" --private-fee-config "$FEE_CONFIG" \
  --moderation-policy "$PUBLIC_POLICY_TEXT"
```

Confirm the resulting published policy/version and retain historical policies for previously published posts. A new policy does not authorize evaluating older posts under the wrong policy. Configuration changes are public actions; do not place credentials or private instructions in policy text.

For an interrupted flag, use its exact saved post ID, policy version and reason. Inspection is read-only:

```sh
./scripts/operator-launch.sh author declare-immoral --inspect-only --json \
  --portal-address "$PORTAL" --node-url "$AZTEC_RPC" --eth-rpc "$ETH_RPC" \
  --censor-wallet "$CURRENT_CENSOR_WALLET" \
  --post-id "$SAVED_POST_ID" --expected-policy-version "$SAVED_POLICY_VERSION" \
  --censor-response "$SAVED_REASON"
```

To reconcile through the supported signer path, use the same command and exact saved values, replace `--inspect-only` with `--reconcile-previous`, and add `--private-fee-config "$FEE_CONFIG"`. That operation can submit a replacement when journal/reconciliation rules permit; it is not read-only. Unknown or pending outcomes must remain unresolved rather than triggering blind resubmission. Normally restart the daemon with its existing `--state-dir` and matching signer configuration so its durable queue coordinates this work.

Do not use generic `recover --censor-wallet` as shorthand: the CLI selects the censor wallet only for moderation actions and explicit censor `list`, not generic recovery. For author actions, `recover` checks the saved Aztec transaction; `recover-eth` checks the saved Ethereum request and `--retry-ethereum` explicitly retries its original nonce/details. Keep author and moderator recovery contexts distinct. No recovery command extends an expired moderation window.

## Historical provider credential

The original repository carried an Aztec Labs V5 RPC credential in
`shared/rpc-config.json`. The unused configuration file has been removed from the
current tree. Its value must not be copied into documentation, public configuration,
or a deployment. Git history still contains the exposure; deleting the file does
not revoke the credential. External revocation has not been verified.

The deployment owner must arrange replacement/revocation with the provider and
apply appropriate origin, scope and usage restrictions before production. Record
only the provider, credential identifier and completed action in the private
operator record. The public configuration validator rejects query credentials
and URL user information, but cannot determine whether an arbitrary URL path
contains a provider token; exported endpoint paths must also be public-safe.

### Checkpointed feed lag

After each completed moderation cycle, the daemon emits a separate
`billboard-feed-lag-v1` observation. It compares the feed's last verified **L2 block
height** with the configured node's checkpointed L2 tip: blocks whose enclosing
checkpoint has been published on Ethereum. It does not compare proposed blocks,
checkpoint sequence numbers or finalized height. A separate read-only client makes
three parallel requests with five-second HTTP timeouts; signing/reconciliation
client timeouts are unchanged. No polling loop or service is added.

The observation checks node chain/rollup identity and the saved feed block's
canonical hash. Matching progress reports `FEED_AT_CHECKPOINTED_TIP`; positive
`lagL2Blocks` reports `FEED_BEHIND_CHECKPOINTED_TIP` as an advisory warning. Check
catch-up and moderation deadlines; positive lag alone does not prove an expired
obligation. Missing data, mismatched hashes, regression, wrong identity or timeout
reports `FEED_LAG_UNKNOWN`, never zero lag. This is relative to that node, not an
independent measure of global network freshness or elapsed lag time.

Ingestion age remains a separate health measure. Feed-lag observation failures do
not mutate jobs, authorize signing or change whether `--once` work completed.
External monitoring should alert on missing daemon output as well as reported
warnings. Reorgs during a health snapshot remain possible; existing canonical
checks at signing and receipt reconciliation remain authoritative.
