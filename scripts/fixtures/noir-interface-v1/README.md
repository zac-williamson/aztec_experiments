# V1 note layout fixture

This isolated library tests the proposed DepositNoteV1 and PostNoteV1 layouts
with the actual pinned Aztec note macros and Packable implementation. It does
not edit or import a sliced copy of the production contract.

After installing the pinned dependencies/compiler and completing the normal
contract build (which resolves and verifies the source cache), run from the
repository root with the pinned Node version:

```sh
node scripts/fixtures/noir-interface-v1/run.mjs
```

The runner verifies the compiler identity, installed packages and complete
locked Noir dependency trees before executing pure tests, and checks source
integrity again afterward. A fresh checkout must use the normal repository
bootstrap/build steps first; unverified or absent cache entries are rejected.
No TXE service or remote oracle is required. The compiler itself takes a lock
on its dependency cache, so the environment must permit that cache lock.

The fixtures assert exact packed arrays, both boolean representations,
maximum-width scalar roundtrips, every generated selector, typed query-option
construction, and unpack/range behavior. Selector offset/length are measured
in **bytes**, not bits. The proposed 10/7 scalar layouts occupy 10/7 Fields;
each selector has byte offset 0 and length 32 at its declared ordinal index.

Raw u32/u64/u128 unpacking truncates overflow. The fixture records this behavior
and verifies that an explicit `unpack(raw).pack() == raw` boundary guard rejects
noncanonical integer encodings while accepting ordinary note controls.

Raw EthAddress unpacking retains its inner Field without enforcing 160-bit
range. The fixture explicitly demonstrates this and separately demonstrates
that `validate()` rejects an oversized unpacked address. Future contract code
must validate arbitrary-origin address values; typed construction with
`EthAddress::from_field` also checks the range. Note-range fixtures are not
proofs of circuit ancestry, ownership, application authorization, or correct
oracle filtering.

Seven commitment tests independently construct the CONFIG, READY, CLAIM, EXIT,
maximum-amount CLAIM, ASCII policy, and Unicode policy preimages from
their scalar inputs. Noir pads the ASCII domains, serializes each Field with
`to_be_bytes()`, appends the exact policy UTF-8 bytes where applicable, and uses
the actual `sha256_to_field` implementation. Both constructed bytes and hashes
must match `scripts/fixtures/protocol/commitments-v1.json`. The runner
rejects a changed vector file until these independent fixtures are reconciled.
There are 22 tests in total: 15 packing/range/selector cases and seven commitments.
