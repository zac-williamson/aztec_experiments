# Packaged monitor route preparation

Added fixed `monitor` route to both JavaScript and shell operator launchers. The existing package builder traverses ROUTES import closures; required monitor, health, public config and trusted portal runtime dependencies are asserted in the real package smoke test. Added actual packaged monitor invalid-config and moderator secret-bearing invalid-argument smoke checks. Changed packaged moderator no-argument expectation from raw configuration text to its fixed unavailable diagnostic; nonzero exit remains required.

Lightweight existing launcher checks: six selected tests pass (shell preload rejection, module/telemetry rejection, all routes including monitor with clean environment and literal arguments, dependency restrictions, inherited PATH rejection, dynamic resources). Full package smoke intentionally not run by this agent while root browser qualification is active; root owns that sequential check.

Runbooks added source-backed current-censor transfer, policy change, exact saved flag inspection/reconciliation, restart state preservation and limitations. No transaction sent, key loaded or network call performed. These commands are documented capabilities, not a completed operator drill or O01 completion.
