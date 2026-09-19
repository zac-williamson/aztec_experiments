# Browser selection and capability review

The existing application supervisor now receives an explicit engine from each
named scenario. Firefox and WebKit use the same private-post flow and canonical
verifier; Chromium retains the same persistent-profile recovery implementation.
Unknown/missing engines and unsupported engine/scenario combinations fail.
Executable availability is checked before starting the chain fixture. This is
not a complete integrity check of every optional browser installation component.

scheduler_improvements reviewed the integration and found no new lifecycle owner,
alternate fee route, engine substitution, deadline change or weakened assertion.
The 45 harness tests pass. The existing hosting component also requires an engine
and exercises actual readiness, private workers, database writes and encrypted
wallet creation. It does not claim proof qualification.

Firefox 146.0.1 passed hosting051 in 10,940 ms with peak 855,936 KiB and full cleanup.
WebKit051 failed the public-page probe in 12,566 ms; diagnostic052 failed in 2,609 ms.
The latter establishes that secure context, isolation, shared memory, OPFS,
createWritable and Worker APIs exist. It disproves the missing-API hypothesis;
it does not establish which API operation failed.

Root split public WebAssembly/worker checks into separate stages and removed the
duplicate handwritten OPFS probe. The actual product readiness write/read/delete
check and actual SQLite round-trip remain mandatory. The reviewer approved this
simplification and worker-constructor cleanup. Fixed readiness error codes are
retained; raw errors and private state are not. Diagnostic054 still needs to run.
