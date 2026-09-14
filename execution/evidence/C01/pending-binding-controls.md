# Pending binding authority controls — not applied

Patch `pending-binding-controls.patch` SHA-256 `39123025388f747c61692177cd765ed2f3f3ad60063bea44999e60e2643b6569` changes only `billboard/billboard_test/src/c01.nr`. Required base hash `7da6795e594a42907af38e415c9763f7805b521aa7b7936945a137d67db6e608`; candidate hash `2b5a7350af8d6cca135fad1f720fe9e6f54a6308097f9042d2e346263111eef9`. Frozen application/test sources remain untouched. No test, compile, proof or network run was performed.

Four direct maintained TXE negatives, all on an actually initialized board:

- Nondeployer private `update_portal` must reject `Only deployer can set portal`.
- Direct public `_set_portal_public`, even from the original deployer, must reject `Function _set_portal_public can only be called by the same contract`.
- Authorized private binding to zero must reject `Zero portal`.
- A second private binding must reject `Portal address already set -- immutable`; the test first verifies successful original binding and reads back the original address before attempting a different nonzero address.

Exact reason for the public guard is verified in pinned `aztec/src/macros/internals_functions_generation/external/public.nr:99–102`, which generates `assert(self.msg_sender() == self.address, ...)`. Other reasons are the existing production assertions. Tests call real `TestEnvironment.call_private`/`call_public` and generated contract interfaces. Existing `bound_setup`, successful claim setup and genuine Ready run remain positive controls. The test annotations verify rejection; they do not claim post-revert transactional state inspection or genuine native proof acceptance.

Although only test source changes, `scripts/artifact-provenance.mjs:contractInputs` scans all billboard `.nr` files. After the active run, root must apply and run focused/full tests, refresh the contract-input manifest through the maintained build, and compare the generated production board artifact/bytecode and verification material with the genuine-run inputs. Preserve old evidence hashes; only record equivalence if the actual comparison succeeds. No production `.nr`, portal, ABI or dependency changes are proposed.
