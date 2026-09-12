# M01 integrated acceptance

The model-to-signer boundary now uses bounded data and fixed host authority.
This record covers process and input separation, not completed moderation service
reliability, model quality, real-chain transactions or production readiness.

## Integrated checks

Working directory: repository root. Node 24.15.0 on macOS; Docker environment and
immutable fixture image are recorded in model-isolation.md. All fixture inputs
are disposable. No existing wallets, real funds or external transaction targets
were used.

- `npm run test:moderation` under pinned Node: exit 0; 75 moderation parser/HTTP,
  53 signer argument/authority, 17 daemon integration, 10 wallet selection checks
  passed (155 total). Raw output: integrated-moderation-tests.log.
- `npm run test:cli-sdk`: exit 0; five offline SDK cases passed. This smoke extracts
  existing SDK loader/account functions, not complete CLI network operations;
  wallet-review.md separately reviews actual CLI-to-engine input wiring.
- Actual Docker profile tests: model-isolation.log and model-isolation.md describe
  the observed process, filesystem, environment, network and fixed-route tests.
  These use a harmless executable in the real production isolation profile.
- `python3 -m unittest discover -s execution/tests -v`: exit 0, 29 graph tests.
  `git diff --check` passed. CI now runs both ordinary moderation tests and the
  explicit Docker profile, but hosted CI has not been run or pushed.

## Criterion interpretation

M01-A01: Quotes, backticks, substitutions and semicolons reach the harmless Node
argv fixture as one argument, without a shell. Controls/newlines, malformed Unicode,
leading option prefixes and oversized UTF-8 reasons are rejected. HTTP response
limits and deadlines also cover streaming bodies; unclear responses cannot mean OK.

M01-A02: The signer exposes list with no arguments and flag with exactly postIndex
and reason. Executable, operation set, wallet, portal and node are fixed at startup.
The index comes from validated fetched posts, not model output. The production CLI
cannot select the programmatic mock runtime. Censor commands read their configured
censor wallet without falling back to an unrelated ETH or Aztec user wallet.

M01-A03: Malformed, incomplete, unavailable or oversized model replies throw typed
errors and do not authorize a flag. The daemon logs sanitized errors, preserves
failed jobs in its in-memory cursor logic and returns failure in once mode. Old
permissive parsing was deliberately tightened; MODERATION_PROTOCOL.md explains the
legacy cases retained and ambiguous cases now requiring errors.

M01-A04: Integrated tests and the actual Docker probe passed. The model is in a
non-root isolated container with only its model file mounted; no signer filesystem,
secret environment or Docker socket is supplied. The transport is fixed-route and
has no signer material. Host administrator, Docker daemon and kernel remain trusted.
The intended production host must repeat the actual profile checks before release.

## Known downstream work

M02 still owns durable jobs, receipt confirmation, restart recovery, incremental
feed and current on-chain policy. The existing engine can accept a nonpending
reverted receipt (W03/M02); CLI success here is not confirmed chain success. Policy
fallback can be stale, and administrative set-moderation-policy is missing from the
engine needsPXE list. M01 does not waive these findings. M03 must supply an actually
reviewed, digest-pinned LLM image/weights, compatible executable and measured corpus
quality/resource behavior. External audit, proof, soak and network release gates
remain mandatory. AI cross-review is not independent external audit.
