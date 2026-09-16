# Truthful withdrawal recovery

A missing local deposit note no longer reports successful withdrawal. The engine
requires the exact canonical successful exit for the active receipt, authenticates
original claim custody and recomputes the selected private chain for this Aztec
owner. Wrong chains, missing custody, reverted exits and unavailable history remain
unknown. The full reconciliation is bounded to20seconds and makes no transaction.
Success is reported only outside that deadline callback.

Validation: withdrawal-integrated-019.log records184 passing engine, journal,
receipt and artifact/provenance checks. withdrawal-browser-020.log records actual
built-browser recovery with four fresh profiles, at most two concurrently open.
The UI chain responses are controlled fixtures; no new genuine proof is claimed
for this read-only recovery change. withdrawal-sdk-019.log and
withdrawal-apps-019.log record builds. The focused suite includes exact canonical
exit success without another fee, missing/reverted history, wrong selected chain,
missing claim custody and stalled receipt custody lookup.

AI review: withdrawal-review-020.md. Both findings (scope mismatch and unbounded
reads) were fixed and regression-tested. This is not the external release audit.
Source binding: source-withdrawal-020.json; artifact-manifest-withdrawal-020.json.
W03 remains active for other stale-action handling and final stage qualification.
