# Supported operator launch

The real-key operator profile starts through `scripts/operator-launch.sh` inside a
prepared runtime package. Direct `node cli.mjs`, repository developer commands,
TXE and compiler tools are outside this profile. The wrapper rejects Node preload
and module-search configuration before Node starts, accepts only disabled telemetry,
and creates a fresh environment. Its JavaScript child checks the exact Node pin
and selects a fixed application entrypoint. Wallet values belong in explicit
application arguments/files, not inherited environment variables.

Packaged commands:

```
./scripts/operator-launch.sh author <action> <application options>
./scripts/operator-launch.sh deploy <deployment options>
./scripts/operator-launch.sh moderator <moderation options>
./scripts/operator-launch.sh monitor /absolute/path/to/exported-public-board-config.json
./scripts/operator-launch.sh recover-wallet <recovery options>
```

Executable overrides (including the moderator's `--cli`) are rejected. Arguments
are passed as literal values without a shell. Telemetry is disabled with
`OTEL_SDK_DISABLED=true` and `OTEL_PROPAGATORS=none`; other OTEL settings are rejected,
not silently inherited. Child signer integration must preserve this profile when
calling the author CLI. Docker remains a separately installed moderator prerequisite;
its executable is discovered only through the fixed system PATH. Model images and
weights remain separately pinned, verified inputs, not arbitrary bundled test assets.

Prepare the package with the verified, pinned Node executable:

```
node scripts/package-operator.mjs --inventory /absolute/path/to/pinned/node
node scripts/package-operator.mjs /absolute/path/to/pinned/node /new/package/directory
```

Run packaging in the controlled build environment, without untrusted Node startup
options. The destination must not exist. Inventory mode verifies current SDK inputs/outputs and canonical frontend
provenance, including public-feed metadata, and checks CRS hashes without copying
large assets. Missing or stale build provenance fails before package creation.
The same checks run again after inventory to catch concurrent build-input drift. The package contains explicit application
entrypoint/import files, declared dynamic resources, verified SDK outputs and CRS,
pinned Node, and the resolved ethers 6 / fake-indexeddb runtime dependency closure.
It does not copy repository `node_modules` wholesale. Native Aztec imports, ethers 5,
`@ethersproject`, elliptic, TXE and developer Aztec CLI packages fail packaging.
Offline recovery is bundled separately with the pinned build compiler. Its manifest
records every bundled input and rejects forbidden developer dependencies. The
bundle uses a module-local browser WASM selection and does not replace global
process/SDK objects; its real claim hash and encrypted restore are tested in a
clean child without repository dependencies.

Every copied file has a digest recorded in `operator-package.json`; symlinks and
out-of-tree package inputs are rejected. Public web pages are a separate static
build and are not exposed by this operator package.

The package builder is an engineering control, not a release signature or current
network clearance. A release must verify its final inventory and exercise the real
packaged commands without the repository's dependencies. Source changes introducing
new dynamic resources require an explicit inventory update and renewed checks.
No launcher can protect against an administrator replacing its code, modifying its
runtime, or running another executable. A Node launcher alone also cannot undo a
preload that ran before it; this is why the shell wrapper is the supported entrypoint.

The `monitor` route performs the bounded read-only escrow observation described in
[operations.md](operations.md). Its import closure and trusted portal runtime metadata
are included in the package inventory. It does not load a signer or submit transactions.
