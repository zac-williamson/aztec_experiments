# Test hierarchy

Use the pinned Node 24 and Foundry versions in BUILDING.md. Run serially, in this order:

1. `npm run test:harness` checks the supervisor with tiny real processes, strict scenario selection, command IO and browser handoff contracts. No blockchain or prover starts.
2. `npm run test:components` checks application boundaries, setup verification and client behavior. `npm run test:application:unit` additionally executes Noir/TXE and Solidity constraints. These do not establish genuine transaction acceptance.
3. Build the release assets, then run the actual offline CLI initialization check: `node scripts/test-cli-prover-offline.mjs`. Package checks must pass before testing packaged commands.
4. `npm run test:e2e -- SCENARIO` runs one explicit scenario. Start with `node`, then `included-board`, then `activated-board` before exercising complete journeys.

Preserve a failed harness check's stage, command outcome and cleanup outcome. Diagnose and fix the underlying cause, then verify the repair; the user has authorized autonomous continuation. Delegate an independent structural review whenever changing the harness. No alternate backend, fee payer, data source or test scenario may stand in for a failed path.

## Structure

- `scripts/testing/supervisor.mjs` owns application-test child processes, the single 540-second deadline, sampled aggregate 2 GiB limit and cleanup. Browser and native children share this owner; do not wrap these scenarios in another supervisor.
- `fixture-worker.mjs` creates the disposable local chain. `c01-real-node.mjs` owns the verifier node and builds the explicitly requested board fixture.
- `scenarios.mjs` declares the supported scenarios. `scenario-flows.mjs` states each action sequence. Proof and assertion helpers remain ordinary functions.
- `assets.mjs` checks source identity, prover setup and operator package contents. Build or asset failures stop before proving.

There are no implicit defaults, cascading environment flags or legacy aliases. The old empty invocation and `--bridge`, `--ready`, `--settle`, `--include`, `--posting-diagnostic` routes are removed. Their unique deployment/binding assertions belong to the included/activated fixtures; private-fee journeys replace the public-fee bridge route.

## Scenarios

| Scenario | What it checks |
|---|---|
| `node` | Disposable node startup and genuine transaction verifier configuration |
| `included-board` | Real board deployment proof and ordinary inclusion |
| `activated-board` | Ready binding, actual emitted message and controlled portal activation |
| `censor-commands` | Packaged moderator handover and successor policy change with private fees |
| `private-fees` | Private fee funding, collateral claim, exit and Ethereum refund |
| `private-fee-post` | Cold private fee claim and private-balance posting |
| `flagged-journey`, `unflagged-journey` | Posting, screening, eligible exit and refund |
| `redeposit` | Second deposit/refund and replay rejection |
| `proof-recovery` | Stale post proof and journal-linked replacement |
| `note-attribution` | Same-note screening/withdrawal attribution |
| `contention` | Ten authors posting from one anchor; explicitly genesis-funded constraint fixture |
| `screening` | Authenticated screening constraints; explicitly genesis-funded constraint fixture |
| `browser-post` | Actual GUI posting after native private-fee setup |
| `browser-journey` | GUI deposit, claim, post, screening, withdrawal and refund |
| `browser-post-recovery` | Accepted post, lost response, browser restart and original transaction recovery |

The two genesis-funded constraint scenarios test application authorization and conflicts. They do not qualify private fee anonymity and never select their payer after a private-payment failure.

## Boundaries

Application transactions are genuinely proved and checked by the node. Local bridge tests use the installed SDK's explicit Outbox settlement controls. Network epoch proving, Ethereum finality and protocol verifier qualification are outside the application test. No network prover, custom AVM build or Docker is required.

Fixture-only budgets are 60 seconds for node startup, 120 seconds for board inclusion and 180 seconds for activation. Full journeys retain 540 seconds. All expensive runs are serial, below ten minutes, and use disposable identities. Native contention uses two client threads; other profiles use one. Resource limits do not establish production capacity. No automatic retries or threshold increases are allowed. Rerun affected checks after diagnosing and repairing the underlying failure.

Historical results remain bound to their original source snapshots. The new harness must be qualified from the bottom up before it can replace those results. A passing application suite is neither deployment clearance nor independent review. Browser coverage, load, audit, soak and target-network clearance remain separate graph requirements.
