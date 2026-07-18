#!/bin/bash
# Build VKs for private functions using the v5 bb binary
set -e

BB=/nix/store/xlbczvrsm8bmh4pswbci0l01xq3dc23r-aztec-barretenberg-bin-5.0.0-nightly.20260529/bin/bb
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARTIFACT="$SCRIPT_DIR/billboard_artifact.json"
TMPDIR=$(mktemp -d)

echo "Extracting bytecodes and computing VKs..."
python3 -c "
import json, os, base64

with open('$ARTIFACT') as f:
    art = json.load(f)

tmpdir = '$TMPDIR'
priv_funcs = []
for func in art.get('functions', []):
    attrs = func.get('custom_attributes', [])
    is_private = 'abi_private' in attrs
    is_utility = 'abi_utility' in attrs or func.get('is_unconstrained', False)
    if is_private and not is_utility:
        bc_b64 = func.get('bytecode', '')
        name = func['name']
        bc_path = os.path.join(tmpdir, name + '.bytecode')
        with open(bc_path, 'wb') as bf:
            bf.write(base64.b64decode(bc_b64))
        priv_funcs.append(name)
        print(f'  Extracted: {name} ({len(base64.b64decode(bc_b64))} bytes)')

with open(os.path.join(tmpdir, 'priv_funcs.json'), 'w') as f:
    json.dump(priv_funcs, f)
"

PRIV_FUNCS=$(cat "$TMPDIR/priv_funcs.json")
for name in $(python3 -c "import json; [print(f) for f in json.load(open('$TMPDIR/priv_funcs.json'))]"); do
    echo "  Computing VK for: $name"
    BC_FILE="$TMPDIR/${name}.bytecode"
    VK_DIR="$TMPDIR/${name}_vk"
    mkdir -p "$VK_DIR"
    "$BB" write_vk -b "$BC_FILE" -o "$VK_DIR" -t noir-rollup -s chonk --output_format binary 2>&1 | tail -3
done

echo "Injecting VKs back into artifact..."
python3 -c "
import json, os, base64

with open('$ARTIFACT') as f:
    art = json.load(f)

tmpdir = '$TMPDIR'
vk_count = 0
for func in art.get('functions', []):
    attrs = func.get('custom_attributes', [])
    is_private = 'abi_private' in attrs
    is_utility = 'abi_utility' in attrs or func.get('is_unconstrained', False)
    if is_private and not is_utility:
        name = func['name']
        vk_dir = os.path.join(tmpdir, name + '_vk')
        vk_file = os.path.join(vk_dir, 'vk')
        if os.path.exists(vk_file):
            with open(vk_file, 'rb') as f:
                vk_bytes = f.read()
            # Store as base64 (as the SDK expects)
            vk_b64 = base64.b64encode(vk_bytes).decode('ascii')
            func['verification_key'] = vk_b64
            func['verificationKey'] = vk_b64
            print(f'  {name}: VK injected ({len(vk_bytes)} bytes)')
            vk_count += 1
        else:
            print(f'  {name}: VK file not found at {vk_file}')

with open('$ARTIFACT', 'w') as f:
    json.dump(art, f)
print(f'Injected {vk_count} VKs total.')
"

rm -rf "$TMPDIR"
echo "Done!"
