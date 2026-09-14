# Server padding output qualification

The first two server wrapper runs reached a successfully returned, internally
verified proof, then failed an extra harness output assertion. Typed SDK binary
serialization and Noir field serialization differ. A third diagnostic run
recorded only synthetic public output values: indices122 and140 were1, all
other fields0. These indices correspond exactly to the start/end blob
accumulator curve points' is_infinity booleans in the pinned circuit ABI.

The corrected harness derives all149 positions from that ABI, requires precisely
those two named boolean paths, constructs the complete expected empty encoding,
and compares every field. No circuit, dependency, public input or verifier was
changed to make the check pass. It independently verifies the returned native
proof, requires corrupted-proof verification to return false (not throw/crash),
and re-verifies the original. The successful report is
server-padding-e44353c0-0e3e-4d7d-a082-f8dbc4fcd8de.json.

The standard server API is exercised with a pinned WASM witness CLI adapter and
an explicit one-thread native-BB launcher. This is a local test profile, not
native ACVM or production server qualification. Full epoch proof publication and
canonical finalized board bridge consumption remain unobserved.
