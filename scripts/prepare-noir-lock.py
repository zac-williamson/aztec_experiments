#!/usr/bin/env python3
"""Prepare a schema-2 candidate from fresh compiler artifacts, never authenticate it.

Default graph: billboard workspace, avatar experiment, private-Bok workspace.
Supply all seven contract artifacts with repeated --artifact. Additional manifests
and required contract names can only extend that default CLI scope. Verify the
candidate with verify-noir-origins.py before explicitly promoting the lock.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import tomllib

DEFAULT_MANIFESTS = ('billboard/Nargo.toml', 'experiments/avatar/Nargo.toml', 'experiments/private-bok/Nargo.toml')
DEFAULT_CONTRACTS = ('Billboard', 'PrivateFPC', 'PluginAdapter', 'AvatarLogProbe', 'RollingBoard', 'PrivateBok', 'InvocationProbeBoard')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked(base, value):
    """Confine reads and reject symlinks, including a link before a '..' segment."""
    candidate = pathlib.Path(value)
    if not candidate.is_absolute():
        candidate = base / candidate
    try:
        relative = candidate.relative_to(base)
    except ValueError:
        raise ValueError('Path outside allowed root') from None
    current = base
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('Symlink in source path')
    normalized = pathlib.Path(os.path.abspath(candidate))
    if not normalized.is_relative_to(base):
        raise ValueError('Path escapes allowed root')
    return normalized


def strict_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=unique)


def prepare(root, cache, artifact_paths, manifests=DEFAULT_MANIFESTS, required_contracts=DEFAULT_CONTRACTS):
    root, cache = pathlib.Path(root), pathlib.Path(cache)
    if root.is_symlink() or cache.is_symlink():
        raise ValueError('Symlink root')
    root, cache = root.resolve(strict=True), cache.resolve(strict=True)
    if root == cache or root.is_relative_to(cache) or cache.is_relative_to(root):
        raise ValueError('Ambiguous repository/cache roots')
    required = set(required_contracts)
    if not required or len(required) != len(required_contracts) or any(not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,127}', name) for name in required):
        raise ValueError('Invalid or duplicate required contract')
    if not manifests or len(set(manifests)) != len(manifests):
        raise ValueError('Empty or duplicate manifest scope')
    packages, local, local_sources, visited = {}, {}, {}, set()

    def visit(directory, external=False):
        base = cache if external else root
        directory = checked(base, directory)
        if directory in visited:
            return
        visited.add(directory)
        manifest = checked(base, directory / 'Nargo.toml')
        content = manifest.read_bytes()
        parsed = tomllib.loads(content.decode())
        files = {'Nargo.toml': sha(content)}
        if 'package' in parsed:
            source = checked(base, directory / 'src')
            if not source.is_dir():
                raise ValueError('Missing package source directory')
            def scan(folder):
                for entry in sorted(folder.iterdir()):
                    entry = checked(base, entry)
                    if entry.is_dir():
                        scan(entry)
                    elif entry.is_file():
                        files[entry.relative_to(directory).as_posix()] = sha(entry.read_bytes())
                    else:
                        raise ValueError('Unexpected source type')
            scan(source)
            if len(files) == 1:
                raise ValueError('Empty package source tree')
        if external:
            name = 'dependencies/' + directory.relative_to(cache).as_posix()
            if not name.startswith('dependencies/github.com/') or 'package' not in parsed:
                raise ValueError('Invalid external package path')
            packages[name] = {'files': files}
        else:
            local[manifest.relative_to(root).as_posix()] = sha(content)
            local_sources.update({(directory / name).relative_to(root).as_posix(): digest for name, digest in files.items() if name != 'Nargo.toml'})
        for member in parsed.get('workspace', {}).get('members', []):
            if not isinstance(member, str) or pathlib.Path(member).is_absolute() or '\\' in member:
                raise ValueError('Invalid workspace member')
            visit(directory / member, external)
        for dependency in parsed.get('dependencies', {}).values():
            if not isinstance(dependency, dict):
                raise ValueError('Invalid dependency declaration')
            if set(dependency) == {'path'}:
                value = dependency['path']
                if not isinstance(value, str) or pathlib.Path(value).is_absolute() or '\\' in value:
                    raise ValueError('Invalid local dependency path')
                visit(directory / value, external)
            elif 'git' in dependency and 'tag' in dependency and set(dependency) <= {'git', 'tag', 'directory'}:
                match = re.fullmatch(r'https://github.com/([\w-]+)/([A-Za-z0-9_][\w.-]*)', dependency['git'])
                tag, subdir = dependency['tag'], dependency.get('directory', '')
                if not match or not isinstance(tag, str) or not re.fullmatch(r'[\w.-]+', tag) or tag in ('.', '..') or not isinstance(subdir, str) or '\\' in subdir or pathlib.Path(subdir).is_absolute() or '..' in pathlib.Path(subdir).parts:
                    raise ValueError('Unsupported dependency origin')
                visit(cache / 'github.com' / match[1] / match[2] / tag / subdir, True)
            else:
                raise ValueError('Unsupported dependency declaration')

    for name in manifests:
        manifest = checked(root, name)
        if manifest.name != 'Nargo.toml':
            raise ValueError('Expected Nargo manifest')
        visit(manifest.parent)
    external_sources = {package + '/' + filename: digest for package, record in packages.items() for filename, digest in record['files'].items()}
    embedded, origins, seen_paths = {}, {}, set()
    for value in artifact_paths:
        filename = checked(root, value)
        if filename in seen_paths:
            raise ValueError('Duplicate artifact path')
        seen_paths.add(filename)
        raw = filename.read_bytes()
        artifact = strict_json(raw)
        if not isinstance(artifact, dict):
            raise ValueError('Malformed compiler artifact')
        name = artifact.get('name')
        if not isinstance(name, str) or name not in required or name in embedded:
            raise ValueError('Unexpected or duplicate contract inventory')
        if not isinstance(artifact.get('file_map'), dict) or not artifact['file_map']:
            raise ValueError('Empty compiler file map')
        inventory, seen_source_paths = {}, set()
        for entry in artifact['file_map'].values():
            if not isinstance(entry, dict) or not isinstance(entry.get('path'), str) or not isinstance(entry.get('source'), str):
                raise ValueError('Malformed compiler source entry')
            original = entry['path']
            if '\\' in original or '..' in pathlib.Path(original).parts:
                raise ValueError('Invalid compiler source path')
            path = pathlib.Path(original)
            if path.is_absolute():
                if path.is_relative_to(cache):
                    relative = 'dependencies/' + checked(cache, path).relative_to(cache).as_posix()
                elif path.is_relative_to(root):
                    relative = checked(root, path).relative_to(root).as_posix()
                else:
                    raise ValueError('Unknown absolute compiler source')
            else:
                relative = original
            if relative in seen_source_paths:
                raise ValueError('Duplicate or conflicting compiler source path')
            seen_source_paths.add(relative)
            digest = sha(entry['source'].encode())
            if relative.startswith('dependencies/'):
                if external_sources.get(relative) != digest:
                    raise ValueError('Embedded source absent from exact dependency inventory')
                inventory[relative] = digest
            elif relative.startswith('std/'):
                continue  # Compiler stdlib provenance is a separate pinned-compiler gate.
            elif local_sources.get(relative) != digest:
                raise ValueError('Compiler local source differs from declared graph')
        if not inventory:
            raise ValueError('Empty contract dependency inventory')
        embedded[name] = dict(sorted(inventory.items()))
        origins[name] = {'path': filename.relative_to(root).as_posix(), 'sha256': sha(raw)}
    if set(embedded) != required or not packages:
        raise ValueError('Missing required contract artifacts or dependency packages')
    return {'schema': 2, 'algorithm': 'sha256',
            'description': 'Candidate inventory from actual supplied compiler artifacts and complete declared local graphs. Not origin authentication. Independently verify every external tree against official commit archives before promotion.',
            'localManifests': dict(sorted(local.items())), 'packages': dict(sorted(packages.items())),
            'embeddedSourcesByContract': dict(sorted(embedded.items())), 'artifactSources': dict(sorted(origins.items()))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact', required=True, action='append')
    parser.add_argument('--output', required=True)
    parser.add_argument('--cache-root', default=str(pathlib.Path.home() / 'nargo'))
    parser.add_argument('--manifest', action='append', default=[], help='Additional local graph; defaults cannot be omitted')
    parser.add_argument('--required-contract', action='append', default=[], help='Additional expected contract; defaults cannot be omitted')
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent.parent
    result = prepare(root, args.cache_root, args.artifact,
                     DEFAULT_MANIFESTS + tuple(args.manifest), DEFAULT_CONTRACTS + tuple(args.required_contract))
    output = checked(root, args.output)
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'outcome': 'candidate_requires_origin_verification', 'packages': len(result['packages']),
                      'contracts': sorted(result['embeddedSourcesByContract']), 'output': str(output)}))


if __name__ == '__main__':
    main()
