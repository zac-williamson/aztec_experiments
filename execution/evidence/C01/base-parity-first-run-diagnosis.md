# First BaseParity run — retained failure

`native-base-parity-e8fe880a-b30f-4b97-bd65-278123d468da.json` failed.
Stage progression reached genuine proof generation, normal verification, altered
public-root verification, then proof-content corruption. It did not reach normal
reverification. Peak sampled group RSS was3,675,824KiB; elapsed68.33seconds.
There was no memory/deadline stop. Stage ordering supports the preceding
assertions, but this failed run is not passing acceptance evidence.

The parent probed process group4953 during cleanup and received EPERM, then
removed its temporary directory before collecting the worker result. A fresh
read-only `ps` group inspection returned no rows, and a fresh killpg(group,0)
probe returned ESRCH: no owned process remained at that later observation.
This was an OS-level transient/cleanup diagnostic, not an approval rejection.
Its cause is not conclusively established from the missing worker report.

Supervisor correction: collect worker/resource evidence before cleanup/posthash
checks; treat EPERM as a still-present group, tolerate only the signalling error
while waiting within the original bounded cleanup window, and require a genuine
ESRCH before claiming absence. Persist failure if that cannot be established.
No process is considered gone merely because permission was denied.

The corruption control is under source review: changing a final proof field can
alter an elliptic-curve coordinate rather than a scalar evaluation. A native
abort/exception must not count as successful verification rejection. Preserve the
failed experiment; use an identified scalar evaluation for the next discriminating
control without changing the proof/time/memory limits or accepting crashes.

Independent agent source trace identifies zero-based proofFields[40] as
Sumcheck:univariate_0 evaluation0: eight DefaultIO pairing fields, followed by
eight Oink commitments encoded as four Fr fields each. The API separates only
the four user public inputs. Pinned non-ZK UltraHonk proof length is410fields.
The final four proof fields encode KZG:W, so mutating the final field can produce
an invalid curve point. The revised control asserts410/4 field counts and adds
Fr.ONE to scalar40, preserving canonical Fr encoding. The actual sumcheck round
checks evaluation0+evaluation1 against its target sum, so this is a meaningful
proof-content error. Relevant pinned sources: bbapi_ultra_honk.cpp85–102,
special_public_inputs.hpp DefaultIO, FrCodec BN254 scalar count2, sumcheck.hpp404,
and sumcheck_round.hpp850–863. No exception is accepted as a passed control.
