# Evidence protocol

No task completion records exist at setup. Baseline diagnostics live in ../baseline/
and do not satisfy implementation acceptance. Store sanitized real outputs here;
keep credentials, private keys, claim secrets and wallet backups elsewhere.

## Record a source snapshot

From repository root, after integrating the change to be verified:

    python3 execution/graph.py snapshot --output evidence/P01/source-001.json

Use the relevant task ID and a new filename each time. This records tracked and
non-ignored untracked application file hashes, including deletion markers. It
excludes execution documentation and root AGENTS.md. It records the git revision
but does not require a commit or make one. A source fingerprint is a content hash,
not a signature, attestation, or assurance of correctness.

Preserve the old task record and logs under history/ before replacing them. Update
graph.json status/checkpoint and status.md separately; all completion records must
validate. Supporting files may be under evidence/ or release/. All evidence paths
are relative to execution/, cannot escape it, and require actual SHA-256 hashes.

## Per-task record

Create `evidence/<ID>.json` using this structure. Replace every placeholder with
observed information; this example is intentionally not valid completion evidence.
Include one criteria entry for every acceptance ID in the task and link actual
supporting files. The same comprehensive test log may support multiple criteria.

```json
{
  "task_id": "P01",
  "outcome": "pass",
  "recorded_at": "<actual ISO 8601 UTC timestamp>",
  "source_fingerprint": "<fingerprint returned by snapshot>",
  "source_inventory": "evidence/P01/source-001.json",
  "artifacts": [
    {"path": "evidence/P01/source-001.json", "sha256": "<actual hash>"},
    {"path": "evidence/P01/acceptance.md", "sha256": "<actual hash>"},
    {"path": "evidence/P01/review.md", "sha256": "<actual hash>"}
  ],
  "criteria": [
    {
      "id": "P01-A01",
      "result": "pass",
      "summary": "<observed outcome, method and limitations>",
      "artifacts": ["evidence/P01/acceptance.md"]
    }
  ],
  "review": {
    "kind": "self-review",
    "reviewer": "<actual reviewer or agent run identity>",
    "summary": "<reviewed diff, assumptions, test independence, residual issues>",
    "artifacts": ["evidence/P01/review.md"]
  }
}
```

Record commands and working directory, dependency versions, environment identity,
expected/actual results, exit status, elapsed time and failure limitations in the
supporting files. A summary that merely repeats the acceptance criterion is not
sufficient evidence even if it is syntactically valid JSON.

X01/X02 require `review.kind = independent` and actual outside review reports.
O02 requires `review.kind = operator` and actual owner acceptance. X03 requires
fresh official guidance and read-only network observations; record links, content
and dates. Its record expires after seven days. Changing a timestamp without
rechecking the underlying evidence is not a refresh.

T06 also requires:

```json
{
  "soak": {
    "started_at": "<actual start with timezone>",
    "ended_at": "<actual end with timezone>",
    "coverage_artifact": "evidence/T06/monitoring-coverage.json"
  }
}
```

The coverage file must be in artifacts with its hash. At least 336 real hours are
required. The reviewer assesses workload, continuity, incidents and repair impact;
timestamps alone are not proof that a service ran.

## Final acceptance matrix

T05 creates `release/acceptance-matrix.json` with:

- `source_fingerprint`: exact candidate fingerprint.
- `criteria`: exactly one entry per acceptance criterion of every historical
  internal package in graph.json (including R02). Each has `id`, `result: pass`,
  `summary`, and nonempty `artifacts: [{path, sha256}]` relative to execution/.
- `requirements`: exactly one entry per REQ01–REQ12 with `id` and nonempty
  `criteria` containing supporting criterion IDs from the matrix. Additional
  release-only audit/network/operator evidence is checked through R04 dependencies.

Reaffirm design/documentation criteria through review against the final source;
rerun behavior checks on that source. Historical logs may explain a decision, but
cannot substitute for required current behavior. This matrix cannot be filled out
until the acceptance checks have actually been performed.

## Release manifest

T05 creates `release/manifest.json` with `source_fingerprint`, nonempty objects
`toolchain`, `build_inputs`, `target_network`, and `artifacts: [{path, sha256,
category}]`. Artifact paths in this manifest are relative to the application
repository, so generated ignored build outputs can be verified as well as source.
Required categories: `l1_contract`, `l2_contract`, `verification_keys`, `frontend`,
`sdk_workers`, `proving_assets`, `operations`. Include all files actually shipped,
not just one representative file per category. Do not package secrets.

The toolchain object identifies exact compiler, Noir, SDK, prover, Node and L1
dependency versions. Build inputs identify immutable source/patch/proving-asset
provenance. Target network identifies chain, rollup, bridge addresses, protocol
version and config policy. Do not equate a node package version with a rollup ID.

T05 and R04 evidence must hash both manifest and matrix as artifacts. X02, T05,
T06 and R04 use current-source binding. Post-verification application edits make
these records stale and prevent final completion until the affected gates have
been renewed. Audit reports remain historical records; X02 covers changes from
the reviewed snapshot to the final one.

## Blocker record

In graph.json, use status `blocked` with:

```json
{
  "reason": "<specific obstacle>",
  "evidence": "<error output or missing external input reference>",
  "unblock": "<concrete change or input needed>",
  "next_action": "<what to try or what unaffected package to execute>"
}
```

Recheck prerequisites before changing back to active. Record reviewer/operator
requests only after preparing concrete materials and only send messages to others
when the user has authorized them.
