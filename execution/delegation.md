# Current delegated work

Root integrates and runs one expensive job at a time. Graph controls completion;
internal AI review does not replace external review.

| Lane | Agent | Exclusive write ownership | Deliverable |
|---|---|---|---|
| Application | workflow_review | apps/src/billboard/user/engine.js; apps/src/billboard/user/app.js; shared/app-env.js; scripts/test-deposit-message-ready.mjs | Bounded Inbox readiness before claim; claim-only retry after confirmed deposit; cheap regressions |
| Browser recovery | scheduler_improvements | scripts/u01-browser-flow.mjs; scripts/test-t04-checkpoint-scope.mjs | Ordinary empty checkpoints before GUI claim, restored on success/failure |
| Independent review | claim_failure_diagnosis | Read-only | Pinned SDK and receipt identity review, then implementation review |
| Integration/operations | root | Other assigned graph paths and execution records | Integrate evidence, serialize builds/proofs, continue operational drills |

Diagnostic010 completed with cleanup; no heavy job active. ETH deposit succeeded,
claim failed before proof. Missing witness is a source-supported hypothesis, not
an observed RPC result. No further expensive attempt until fixes and cheap checks.
