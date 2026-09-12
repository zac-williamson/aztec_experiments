import path from 'node:path';
// Diagnostic paths only. Never alter bytecode, verification keys, source text,
// debug symbols or function ordering when making artifacts location independent.
export function normalizeNoir(artifact, root) {
  for (const file of Object.values(artifact.file_map || {})) {
    const name = file.path.replaceAll('\\', '/');
    const cache = name.indexOf('/nargo/github.com/');
    if (cache !== -1) file.path = 'dependencies/' + name.slice(cache + '/nargo/'.length);
    else if (name.startsWith(root.replaceAll('\\', '/') + '/')) file.path = name.slice(root.length + 1);
    else if (path.isAbsolute(name)) throw new Error(`Unrecognized absolute Noir diagnostic path: ${name}`);
  }
  return artifact;
}
