#!/usr/bin/env python3
"""Prepare, but do not authenticate, a candidate Noir content lock.

Run the pinned compiler in an isolated workspace first. Explicitly review the
candidate and verify it with verify-noir-origins.py before using it for a build.
This tool never changes the active lock unless its path is explicitly selected.
"""
import argparse
import hashlib
import json
import pathlib
import re
import tomllib


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--cache-root', default=str(pathlib.Path.home() / 'nargo'))
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent.parent
    cache = pathlib.Path(args.cache_root).resolve()
    packages, manifests, visited = {}, {}, set()

    def visit(directory):
        directory = directory.resolve()
        if directory in visited:
            return
        visited.add(directory)
        manifest = directory / 'Nargo.toml'
        content = manifest.read_bytes()
        if directory.is_relative_to(cache):
            name = 'dependencies/' + directory.relative_to(cache).as_posix()
            files = {'Nargo.toml': sha(content)}
            for filename in sorted((directory / 'src').rglob('*')):
                if filename.is_symlink():
                    raise ValueError(f'Symlink in source tree: {filename}')
                if filename.is_file():
                    files[filename.relative_to(directory).as_posix()] = sha(filename.read_bytes())
            packages[name] = {'files': files}
        elif directory.is_relative_to(root / 'billboard'):
            manifests[manifest.relative_to(root).as_posix()] = sha(content)
        else:
            raise ValueError(f'Unexpected dependency directory: {directory}')
        parsed = tomllib.loads(content.decode())
        for member in parsed.get('workspace', {}).get('members', []):
            visit(directory / member)
        for dependency in parsed.get('dependencies', {}).values():
            if set(dependency) == {'path'}:
                visit(directory / dependency['path'])
            elif 'git' in dependency and 'tag' in dependency and set(dependency) <= {'git', 'tag', 'directory'}:
                match = re.fullmatch(r'https://github.com/([\w-]+)/([\w.-]+)', dependency['git'])
                if not match or not re.fullmatch(r'[\w.-]+', dependency['tag']):
                    raise ValueError(f'Unsupported dependency: {dependency}')
                visit(cache / 'github.com' / match[1] / match[2] / dependency['tag'] / dependency.get('directory', ''))
            else:
                raise ValueError(f'Unsupported dependency declaration: {dependency}')

    visit(root / 'billboard')
    embedded = {}
    artifact = json.loads(pathlib.Path(args.artifact).read_text())
    for entry in artifact['file_map'].values():
        filename = pathlib.Path(entry['path'])
        if filename.is_absolute() and filename.is_relative_to(cache):
            name = 'dependencies/' + filename.relative_to(cache).as_posix()
        elif entry['path'].startswith('dependencies/github.com/'):
            name = entry['path']
        else:
            continue
        digest = sha(entry['source'].encode())
        if name in embedded and embedded[name] != digest:
            raise ValueError(f'Conflicting embedded source: {name}')
        matches = [name == package + '/' + relative and digest == value
                   for package, inventory in packages.items()
                   for relative, value in inventory['files'].items()]
        if not any(matches):
            raise ValueError(f'Embedded source absent from resolved package inventory: {name}')
        embedded[name] = digest
    if not embedded or not packages:
        raise ValueError('Empty dependency inventory')
    result = {'schema': 1, 'algorithm': 'sha256',
              'description': 'Content inventory resolved recursively from local Nargo manifests and pinned compiler output. Every external manifest and source-directory file is locked. Updates require independent official archive verification with verify-noir-origins.py; generating this candidate is not origin authentication.',
              'localManifests': dict(sorted(manifests.items())),
              'packages': dict(sorted(packages.items())),
              'embeddedSources': dict(sorted(embedded.items()))}
    pathlib.Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'outcome': 'candidate_requires_origin_verification', 'packages': len(packages),
                      'files': sum(len(p['files']) for p in packages.values()),
                      'embeddedSources': len(embedded), 'output': args.output}))


if __name__ == '__main__':
    main()
