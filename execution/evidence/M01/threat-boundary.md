# M01 boundary and verification target

This defines the implementation review target, not completed acceptance.

The adversary controls public post text and every byte returned by the model.
The model runtime is also treated as potentially compromised. Trusted operator
configuration selects the protocol endpoint, portal, wallet, signer executable,
model image digest and model file hash. A malicious host administrator already
has access to those authorities and is outside this separation claim.

The signer receives a bounded typed request and constructs an argument array for
a fixed executable and allowlisted operation. No request may supply a command,
extra CLI option, wallet path, endpoint or destination. Post indices come from
the board reader, not a field invented in a model response. Both the verdict
parser and signer enforce their own input constraints. Invalid model output is
an observable failure and never authorizes a flag.

The model runs in a restricted container with only the verified model file
mounted read-only. It receives no wallet, project directory, host home, inherited
signer secrets or Docker socket. The endpoint is loopback-only and the network
blocks outbound access. Container identity and isolation configuration must be
checked before the daemon trusts that endpoint. Production must not silently
fall back to a same-user native model or an arbitrary unverified HTTP service.

Tests must exercise actual OS argument delivery against a harmless Node fixture,
not a shell. Container tests use fresh dummy host secrets and attempt to read
those files/environment values from the model context. Missing configuration,
extra mounts, weakened container settings, unavailable/malformed model output,
overlarge responses and unexpected process termination must fail visibly.

Semantic classification quality, model provenance evaluation, durable work
tracking and deadline behavior remain M02/M03 and later acceptance work. Prompt
instructions do not establish the signing or filesystem boundary. AI code review
does not replace the required external application audit.
