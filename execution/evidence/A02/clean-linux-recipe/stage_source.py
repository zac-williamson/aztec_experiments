import datetime
import hashlib
import json
import pathlib
import shutil
import subprocess

root = pathlib.Path.cwd().resolve()
target = root / '.build/A02-clean-linux-source'
if target.exists():
    raise SystemExit('Refusing to reuse an existing clean-build source directory')
target.mkdir()
files = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z']).decode().split('\0')
inputs = {}
symlinks = {}
excluded = []
for name in sorted(set(filter(None, files))):
    parts = pathlib.PurePosixPath(name).parts
    skip = (parts[0] in {'.git', '.build', 'node_modules'}
            or (parts[0] == 'execution' and not name.startswith('execution/interface-fixtures/'))
            or name.startswith(('apps/dist/', 'billboard/target/', 'billboard/portal/out/', 'billboard/portal/cache/'))
            or any(part in {'node_modules', 'wallets', '.pxe-cache', '__pycache__'} for part in parts)
            or name == 'shared/rpc-config.json'
            or pathlib.PurePosixPath(name).name in {'billboard_artifact.json', 'portal_bytecode.txt'})
    if skip:
        excluded.append(name)
        continue
    source = root / name
    if not source.is_file():
        raise ValueError(f'Unexpected source input type: {name}')
    if source.is_symlink():
        link = source.readlink()
        if link.is_absolute() or not source.resolve().is_relative_to(root / 'apps/src'):
            raise ValueError(f'Unconfined source symlink: {name}')
        symlinks[name] = str(link)
    output = target / name
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, output, follow_symlinks=False)
    inputs[name] = hashlib.sha256(source.read_bytes()).hexdigest()
script = root / '.build/A02-verification-tools/run.sh'
shutil.copy2(script, target / 'clean-container-run.sh')
metadata = {
    'schema': 1, 'recordedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'gitHead': subprocess.check_output(['git', 'rev-parse', 'HEAD']).decode().strip(),
    'sourceInputs': inputs, 'sourceSymlinks': symlinks, 'excludedPaths': excluded,
    'helperHashes': {name: hashlib.sha256((root / '.build/A02-verification-tools' / name).read_bytes()).hexdigest() for name in ['run.sh','steps.py','stage_source.py','pack.py','launch.py']},
    'scriptSha256': hashlib.sha256(script.read_bytes()).hexdigest(),
    'commandScript': script.read_text(),
    'sourcePolicy': 'Tracked and current untracked candidate inputs; excludes legacy RPC credential, wallets, host caches, dependencies, generated artifacts and execution history. Includes current interface fixture vectors.'
}
(root / 'execution/evidence/A02/clean-linux-inputs.json').write_text(json.dumps(metadata, indent=2) + '\n')
(target / 'clean-source-inventory.json').write_text(json.dumps({'sourceInputs': inputs, 'sourceSymlinks': symlinks}, indent=2) + '\n')
shutil.copy2(root / '.build/A02-verification-tools/steps.py', target / 'clean-steps.py')
print(f'Copied {len(inputs)} candidate source files; excluded {len(excluded)} paths.')
