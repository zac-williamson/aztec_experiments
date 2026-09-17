# U01 intermediate checkpoint — not acceptance completion

The package remains active. Nothing here clears production deployment, model
quality, browser-family performance, independent review or release gates.

Implemented: strict portable public board settings; live scope/class/portal
runtime verification; fee settings and maximum-charge display; missing browser
prerequisite checks including actual OPFS; bounded safe UI errors; accurate
screening/debt status; literal untrusted rendering; pinned HTTPS hosting and
cross-origin isolation; keyboard focus, labels and field validation repairs.

The browser prover now explicitly uses two WasmWorker threads. The supported
skipSrsInit option prevents implicit unverified network setup downloads; the
application hash-verifies local setup data and loads it into the actual async
prover singleton. The synchronous hashing instance no longer retains a second
full proving CRS. Earlier Sync-only initialization reports remain historical
and do not qualify this actual prover.

- Integrated018:71 checks passed; integrated021:80 checks passed.
- Prover-light020:68 checks passed, including CRS integrity/consumer controls.
- Prover-crs018:actual async worker local setup passed;1003ms initialization,
  4469ms complete hosting run,1377680KiB sampled aggregate peak,zero external
  requests,all owned processes/data cleaned. Not an application transaction.
- Browser-post019:failed before launching browser because the new independent
  verifier omitted the required account scopes in a debug-note query. Genuine
  local fee funding, collateral claim and replay rejection passed first.
  224628ms/1487248KiB aggregate; all owned processes/data cleaned. The query now
  explicitly scopes to the disposable author. Failure report is preserved.
- Browser-post021:subsequent genuine GUI post qualification. Consult its actual
  final report rather than assuming success from this checkpoint.

The browser profile uses genuine native setup only to establish the disposable
board, funding and collateral. It then closes the native client wallet/prover,
restores an encrypted wallet through visible browser controls, and submits the
post from the actual browser application. The genuine node validates the proof;
separate read-only verification checks canonical receipt/block, exact note and
nullifier transitions, content/cooldown, private fee debit and public payer fee
charge. Native setup is not labelled browser proving. No epoch/network prover
runs. The aggregate supervisor includes browser, Caddy, native fixture and node,
with the unchanged540-second/2GiB sampled limit and cleanup requirements.

Remaining: a passing real browser transaction, full GUI journey/recovery cases,
actual keyboard-browser test, supported-engine/load performance qualification,
final integrated review and package acceptance evidence. The newly written
keyboard check is UI-only and uses an explicit public-feed fixture; it cannot
substitute for a genuine funded browser journey.

## Subsequent measurements

Browserpost021 reached the actual browser flow: encrypted restoration, live
connection and transaction simulation completed, but posting failed1592ms after
proving began. It recorded script-src violation, zero external requests and zero
failed HTTP responses. Overall220428ms/1991168KiB; complete cleanup. The codec's
optional dynamic Function optimization was one concrete CSP source, but its
caught fallback means it is not yet established as the posting failure cause.

The browser SDK now resolves the upstream supported msgpackr no-eval exports.
Codec interoperability checks cover existing record encodings, maps, bigint and
typed bytes with string code generation disabled. No security policy was relaxed.

Keyboard023 passed actual HTTPS Tab/Enter/Space, config error/import, step focus,
empty-message aria validation, preserved focus/disclosure on unchanged/changed
feed, and visible field labels.3945ms/1032928KiB; zero RPC/external requests and
complete cleanup. Failed022 mistakenly required a label on deliberately hidden
internal manifest storage;023 verifies it stays hidden instead.

Hosting024 explicitly verifies the same async singleton receives CRS and uses
2threads/skipSrsInit.968ms actual setup,4267ms overall,1517904KiB sampled peak;
zero external requests, complete cleanup. It removes the redundant worker probe
from CRS-enabled checks. This remains initialization, not transaction evidence.

Diagnostic browserpost024 observes only the existing error-formatting boundary,
preserving its inputs/result and leaving the engine/prover/node unchanged. It
retains bounded error type/cause categories and known numeric source locations,
never raw messages/witnesses/private material. Its performance qualification flag
is explicitly false. Consult its actual final report for the outcome.
