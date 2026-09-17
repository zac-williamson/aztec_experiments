# D01 integration review

Root integrated three bounded AI lanes; these are engineering reviews, not the
external audit required by X01/X02. deployment_gap_review authored/verified the
AST-bound runtime helper and actual Anvil mutation test, then reviewed root engine.
It found and fixed unbounded critical reads, malformed boolean handling, provider
cleanup and missing final original/current board class checks.33 final engine
fixtures pass. deploy_fixture_integration reviewed root CLI/browser integration,
found report output validation occurred after transactions, fixed it and retained
seven regression cases; old browser fixtures now supply explicit manifests.
model_failure_review authored launch/package controls; review found SDK output
hashes alone did not bind changed source inputs/public metadata. It added actual
build provenance checks before and after inventory;12 launch/package checks and
actual isolated package smoke pass. Root reviewed changed interfaces, rebuilt
SDK/frontend, exercised actual browser, integrated suites and offline preparation.

The original implementation plan contained suggestions beyond the implemented
minimum (signed manifests, predicted portal addresses and canonical block records
in reports). Final schema deliberately records reviewed intent and observed
addresses/status; journal scopes bind recovery and signed requests. No publisher
signature or canonical snapshot attestation is claimed. Portal address is only
reported after exact runtime verification. Full network adversary resistance and
current protocol clearance remain external/final release obligations.

M03's failed models remain blocked. D01 neither selects a model nor claims
end-to-end moderation capacity. No unrelated portal/out files were included.
