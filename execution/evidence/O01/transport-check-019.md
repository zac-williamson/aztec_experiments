# Direct transport cancellation check 019

Used pinned Node v24.21.0, a real loopback HTTP upstream deliberately holding its response, and the actual transport helper. No Anvil, proof, build or packaged command was run in this check.

## Initial failure (retained)

The initial probe rejected `eth_sendRawTransaction` before any upstream request, then forwarded `eth_chainId` to the hanging upstream and aborted the shared signal. After awaiting transport `close()`, strict `openSockets === 0` failed with **1 !== 0**. The server close callback could complete before the final socket close event updated ownership bookkeeping. The test did not weaken or omit the zero-resource assertion. The probe's finally block closed both local servers.

Live monitor drill 018 independently passed in 2124 ms with all cleanup booleans true on its then-current source. Its report remains valid historical evidence and was not edited.

## Fix and successful rerun

Transport close now captures a completion promise for each owned socket before destroying it and awaits those socket events, the server close callback and all active request handlers. This makes returned cleanup completion mean the recorded sockets and requests are actually gone.

The same direct probe then passed (process exit 0, approximately 97 ms):

```json
{"passed":true,"mutationRejectedBeforeForward":true,"hangingRequestAborted":true,"transportClosed":true,"preAbortedStartupRejected":true}
```

Exact assertions: prohibited mutation returns HTTP 502 and upstream call count remains zero; one permitted read reaches the hanging upstream; abort settles the client request; awaited close leaves `listening:false`, `openSockets:0`, `pendingRequests:0`; the two failed requests are counted; startup with an already-aborted signal rejects with `AbortError`. Probe finally also closes the upstream's owned connections.

Updated helper SHA-256: `d34f16b51e6184faffe3d41b12099faa092e75af5ec2961a3881f5db88ee4377`.

Root must requalify the actual packaged monitor drill against this changed helper hash. This direct check establishes cancellation and mutation rejection only.
