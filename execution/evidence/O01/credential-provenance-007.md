# Provider credential provenance inventory

Reviewed 2026-09-18, repository-local source and Git refs only. No credential
values or credential-bearing URLs are reproduced here. No provider was contacted.

| Provider / purpose | Historical location | Current disposition |
| --- | --- | --- |
| Aztec Labs V5 mainnet RPC access credential | `shared/rpc-config.json`, `apiKey` field; introduced by commit `9681e5a` dated 2026-07-18; also present at `upstream/master` | Same nonempty credential remains in this tracked file at the reviewed HEAD. This is still a repository exposure even though the legacy configuration is no longer consumed by current application code. Remove this obsolete credential-bearing configuration from the current tree. Historical disclosure remains afterward. |
| Same Aztec Labs RPC credential, embedded browser delivery | `upstream/master`: `apps/dist/user.html`, `apps/dist/censor.html`, `apps/dist/deploy.html`, `apps/dist/fee-juice.html` | Exact-value comparison performed in memory confirms historical copies in all four pages. Current tracked-file comparison finds the value only in `shared/rpc-config.json`; no current tracked built page contains that value. |
| Same credential injection mechanism | Historical `shared/app-env.js`, `_getApiKey` and fetch header wrapper; embedded copies in the four historical pages | Current `shared/app-env.js` returns an empty API key and disables browser credential injection. No current runtime reference to the legacy JSON configuration was found. |

Current public configuration uses exact fields in `shared/public-app-config.js`;
there is no API-key field. Endpoint validation rejects URL userinfo, query strings
and fragments. It does **not** recognize secrets embedded in URL paths, so this
validation alone cannot certify that an operator-supplied endpoint is public.
Operators must use endpoints intended for public browser access and must not
put a secret in a path. Browser-exposed provider tokens, if intentionally used
in a separate supported deployment arrangement, must be treated as public and
restricted appropriately by the provider; this inventory does not authorize
adding a new gateway or credential service.

The deployment CLI still supports an operator-supplied `AZTEC_API_KEY`
environment value through an exact-target fetch wrapper. That is a separate,
non-hardcoded credential input; this review did not inspect user environment
values. The packaged operator launcher currently strips unapproved environment
variables, so standalone CLI capability does not imply packaged credential support.

## Required operator action

The provider-account owner must replace/revoke the historically exposed credential
and document provider-side restriction and endpoint ownership for the intended
production configuration. Removing the local file is not revocation. Record the
result without including old/new credential values, and validate replacement
configuration using disposable tests in the O02 operations drill. No named external
provider-account owner or confirmed revocation result is available in this review.

## Scope and limitations

This is a bounded inventory of the known RPC-config credential: reviewed its
introduction, the upstream baseline, current code paths and exact-value occurrence
in current tracked files, plus the four historical browser artifacts. It is not an
exhaustive secret scan of every historical blob, dependency, ignored output or
external deployment. No unrelated home files, account dashboards or live credentials
were accessed. External revocation, restrictions, billing/account ownership and
previously published copies cannot be verified from repository contents.

This supports O01-A04 inventory preparation; it does not complete production
credential replacement or the O02 operator drill. Findings describe the tree at
review time; subsequent removal requires a separate recorded disposition.

## Integration disposition

After this inventory, root removed `shared/rpc-config.json` from the current tree.
The normal application build then passed without it; current public configuration
and operation guidance remain explicit. The removal does not alter Git history,
revoke the provider credential or satisfy the external operator action above.
