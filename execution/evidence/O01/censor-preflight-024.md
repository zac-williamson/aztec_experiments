# Censor preflight failure and fixture isolation

Run024 failed after5183ms with peak416816KiB, at contract-input provenance validation before genesis/board proving. Owned tree and temporary directory were removed. Only the newly added monitor-only Solidity fixture differed from the recorded contract source inventory; no production Solidity input changed.

Moved that standalone fixture to scripts/fixtures/o01-monitor. The exact original contractInputs inventory now equals the existing manifest (check025); no manifest was rewritten and no assertion was relaxed. The first explicit external-source compile025 failed import resolution. Compile026 using the test-root source name succeeded in2.44s; Foundry's preliminary resolver still warns, while solc includes the exact fixture and original test dependency. Actual monitor026 requalified the isolated fixture in1201ms with full cleanup.

Compile command from billboard/portal: FOUNDRY_PROFILE=regression forge build --offline --contracts ../../scripts/fixtures/o01-monitor. Its regression output stays under .build/portal-tests; release contract bytes and input manifest remain unchanged. Next genuine censor run027 retains540s/2GiB and180s per actual packaged command.
