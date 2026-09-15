# Moderation response protocol

M01 accepts a small decision, not a command. The preferred final response is one
JSON object with exactly `isViolation` (boolean) and `reason` (string). Duplicate
keys, nested values, extra fields, missing final content, incomplete output and
multiple model choices are errors. A response cannot supply a post index, wallet,
destination, executable or operation. The orchestrator selects the post; the
signer retains its startup configuration and fixed operations.

The reason must fit 200 UTF-8 bytes, have no C0/C1 or bidirectional formatting
controls, and not begin with `--` after trimming. That last restriction prevents
the existing CLI argument parser from mistaking a reason for an option. Quotes,
backticks, dollar substitutions and semicolons remain ordinary text in a single
argument. Oversized reasons are rejected rather than truncated, so truncation
cannot silently change meaning or split a Unicode sequence.

For existing models, a bounded legacy response may finish with a standalone
`OK` or `VIOLATION - <positive rule number> - <reason>` line. Matching is case
insensitive, and a complete bold Markdown wrapper is accepted. Earlier reasoning
lines are ignored. Arbitrary prose containing those words, a bare `VIOLATION`,
empty output and ambiguous negation sentences are no longer interpreted as
decisions. Their original regression cases now explicitly require an unresolved
error. Valid original standalone verdict and prompt cases remain covered.

The HTTP response must contain exactly one choice with `finish_reason: "stop"`
and nonempty string `message.content`. `reasoning_content` is never used as a
fallback when the final answer is missing. A JSON response format is requested;
servers that reject it produce an observable error and require configuration
review, rather than a silent automatic flag or an inferred OK.

Bounds are 1,024 UTF-8 bytes for post text, 8,192 for policy, 4,096 for the final
verdict and 32,768 for the complete HTTP body. The whole request, including body
streaming, has a 120-second maximum deadline; tests can supply a shorter deadline.
The currently encoded contract limits fit these input bounds. Errors have stable
codes (`INVALID_INPUT`, `INVALID_VERDICT`, `INVALID_REASON`, `INVALID_RESPONSE`,
`RESPONSE_TOO_LARGE`, `MODEL_TIMEOUT`, `MODEL_HTTP_ERROR`, `MODEL_UNAVAILABLE`).
They leave the post unresolved and must not authorize a flag. Durable retries and
backlog recovery belong to M02; classification accuracy and prompt-injection
resistance measurements belong to M03.

These checks constrain data and authority. They do not establish that a model's
decision is correct or that the model process is isolated. The separate process
isolation checks and later model evaluation provide that evidence.

Every signer request also carries the validated post ID and its policy version, selected from fetched public data by the host. The daemon processes only posts matching its atomic current policy snapshot; model output cannot select or override either identity. Historical versions unavailable to the current reader remain unresolved.
