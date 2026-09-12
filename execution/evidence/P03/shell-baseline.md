# Historical shell construction regression

Command: Node24.15.0 `node --test scripts/test-shell-baseline.mjs` from repository
root. Exit0, two tests passed; raw result in shell-baseline.log. Tests use temporary
empty wallet/file fixtures and capturing functions, with zero shell executions,
real wallet reads, model calls or network transactions.

The historical fixture preserves cliBaseArgs/runCli function bodies from upstream
1849967d15d96ab96234091f2fa47d8762a6c06a. Its adjacent manifest records original
source, segment and fixture hashes. The bodies are wrapped in a factory requiring
an injected capture function; the fixture imports no child_process module and
has no default executor. Production code never imports this fixture. Extraction
was a one-time provenance step; running the regression does not source-slice the
live daemon.

The known-bad control confirms double-quoted command construction retains dollar
substitutions and backticks despite quote escaping. The repaired createSigner
boundary emits the same marker text as one element of an argument array with
shell:false and fixed censor/portal selection. These checks detect construction
semantics without evaluating marker text. M01 separately exercised real OS argv
handling with a harmless Node echo process, also without a shell.

The first test run failed on macOS path alias comparison: signer resolves /var to
/private/var. Expected authority path was corrected to the actual realpath, retaining
strict equality; the succeeding run is recorded. This was a test portability issue,
not an authority bypass. Real model prompt-injection reliability is not measured.
