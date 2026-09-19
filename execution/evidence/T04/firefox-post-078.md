# Firefox private posting qualification

Run `node scripts/test-c01-application.mjs browser-firefox-post` passed.
Report: `application-c3af0e24-46ab-489a-9043-a436357fdc25.json`; log: `firefox-post-078.log`.

Firefox155 normal persistent profile, pinned Playwright1.63. Total216753ms; GUI
post45176ms; aggregate peak3624240KiB under the user-authorized4194304KiB cap.
Actual browser proof, submission and canonical node effects passed. All child
cleanup, process absence and temporary-directory removal checks passed. No
external requests, failed HTTP responses, CSP violations or formatter errors.
Source hashes and runtime measurements are embedded in the report.

This covers a post from a pre-funded restored disposable wallet, not the full
deposit-to-withdraw journey or representative hardware performance qualification.
The older Firefox146 timeout is preserved; no unchanged retry was used.
