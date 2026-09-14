# V1 note layouts and Noir commitment vectors

The actual pinned Noir 1.0.0-beta.25 compiler, commit
`75061fab15986eedee4e7d9104ff87dd9fa4ca10`, with Aztec 5.2.0 dependencies passed
all 22 tests in `scripts/fixtures/noir-interface-v1/`. These are an isolated
library using the actual `#[derive(Packable)]`, `#[note]`, typed property and
`NoteViewerOptions` APIs. No production note implementation was changed.

The proposed DepositNoteV1 occupies exactly 11 physical Fields; PostNoteV1
occupies seven. Derivation allocates one Field per listed scalar, without
combining narrow integers. Exact distinct-valued packed arrays and typed
roundtrips verify the order, and maximum-width integer/address/Field controls
verify that adjacent members do not share a physical Field.

Every generated selector has byte offset **0** and byte length **32**, selecting
the entire canonical Field encoding. These API quantities are bytes, not bits.
The bit offset is consequently zero; selection spans the 32-byte encoding,
while the logical scalar still has its own u32/u64/u128/bool/address range.

| Deposit property | Packed Field index |
| --- | --- |
| schemaVersion | 0 |
| depositChainId | 1 |
| depositNonce | 2 |
| amount | 3 |
| l1Depositor | 4 |
| headLink | 5 |
| headSequence | 6 |
| screenedLink | 7 |
| screenedSequence | 8 |
| lastRealSequence | 9 |
| nextAllowedTime | 10 |

| Post property | Packed Field index |
| --- | --- |
| schemaVersion | 0 |
| depositChainId | 1 |
| sequence | 2 |
| postId | 3 |
| anchorTimestamp | 4 |
| previousLink | 5 |
| isDummy | 6 |

Typed `.select(...)` construction succeeds for Field, u64, u128, EthAddress and
bool values using the generated properties. The fixture verifies select counts
and bounded limits. It does not invoke the oracle or demonstrate actual
filtered `HintedNote` retrieval; that integration remains C04.

Range tests found a material distinction: raw u32/u64/u128 `Packable::unpack`
casts truncate overflowing input Fields. Inputs equal to 2^32, 2^64 and 2^128
become zero. Raw EthAddress unpack retains its Field without enforcing 160 bits.
Bool unpack explicitly rejects values outside {0,1}. The earlier incorrect
assumption that unpacking would reject integer overflow is preserved as a
failed diagnostic run in `note-layout-range-probe.log`.

The final fixtures separately verify those raw behaviors and valid roundtrip
controls. At boundaries retaining arbitrary-origin raw packed Fields, an
explicit `unpack(raw).pack() == raw` guard rejects noncanonical integer input;
an explicit `EthAddress.validate()` rejects an oversized address. Typed
`HintedNote` callers cannot invent a raw witness after deserialization: their
actual membership proof must bind the canonical typed reserialization/note
hash, together with the application's owner, slot, contract, deposit-chain and
schema authorization checks. This fixture does not prove those checks exist.

Seven additional tests construct commitment preimages independently in Noir
from scalar inputs: CONFIG, READY, CLAIM, EXIT, maximum nonce/amount CLAIM,
ASCII policy, and Unicode policy. The ASCII domain is right padded to 32 bytes
without casting its full word to a Field. Each numeric/address/Field word uses
the actual `Field.to_be_bytes()`. Policies append the exact UTF-8 bytes after
their byte length. Both the constructed byte array and actual
`aztec::protocol::hash::sha256_to_field` result match the frozen JSON answers.
CONFIG is 384 bytes, READY 224, CLAIM/EXIT 288; policy examples are 136 and 147
bytes. These are byte/hash compatibility tests, not bridge authentication tests.

Run with the pinned Node after the repository's normal dependency/compiler
bootstrap and verified contract build:

```sh
node scripts/fixtures/noir-interface-v1/run.mjs
```

The runner verifies the pinned compiler, installed package versions, the frozen
commitment-vector file, and all six locked dependency packages / 413 files
before executing with warnings denied. It rechecks the dependency inventory
afterward and prints fixture/source-lock fingerprints. Final evidence is
`note-layout-tests.log`; its JSON trailer binds the exact compiler, source lock,
vector file and executed fixture sources. The initial sandbox denied the
compiler's dependency-cache lock; the permitted rerun succeeded. No source
cache was edited by this lane.

No oracle, TXE, real wallet, note query, proof generation, network transaction
or external audit was involved. This freezes a tested interface layout and
commitment encoding, not a production security or deployment claim.
