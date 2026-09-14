# Bounded qs and UUID regression checks

On September14 the patched dependencies passed10 checks under the verified
Node24.21.0 runtime. The checks enforce equal comma-array limits for plain/bracket
keys, safe parsed constructor/isBuffer round-trips, preserved normal Buffer
serialization, UUID bounds rejection before modification, exact valid-offset
writes and actual CommonJS v4 resolution from both gaxios and teeny-request.
Python's standard uuid implementation independently supplied the two name-based
expected UUID values. Existing caller compatibility is tested in addition to
the newly patched methods.

The prior locked qs6.15.3 and uuid9.0.1 archives were fetched into an isolated
ignored test directory and SHA-512 verified against the committed lock before
extraction. Their actual code reproduced the bracket-array limit bypass, the
non-callable isBuffer exception and partial v3/v5 buffer writes. Inputs contained
four short strings or at most24 buffer bytes. No lifecycle scripts, remote target
or exhaustion-sized input was used. Ancillary imports can resolve current root
dependencies; the targeted old qs/uuid source remains the publisher's verified
bytes. No old package is installed in the production dependency tree.

These controls follow the publisher reports for
[qs comma-array limits](https://github.com/ljharb/qs/security/advisories/GHSA-x5fp-wj9c-mxmx),
[qs isBuffer handling](https://github.com/ljharb/qs/security/advisories/GHSA-4mjr-xmp4-gh2g)
and [UUID buffer bounds](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq).
The observed result is corrected dependency behavior, not a claim that all these
conditions were reachable through the deployed message board.

Exact commands, source hashes and outcomes are in `parsing-regression-context.json`;
old package provenance, verbatim probe and observations are in
`parsing-baseline-inputs.json`, `parsing-baseline-probe.cjs.txt` and
`parsing-known-bad-results.json`. `parsing-patched-tests.log` records10 passes with
no failures or skips. The rest of A02's runtime, transport, telemetry, build and
advisory acceptance remains separate.
