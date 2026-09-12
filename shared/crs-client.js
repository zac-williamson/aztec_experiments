// Shared browser/Node CRS loading. The manifest comes from the source build,
// never from a cache or CDN. Every local and remote byte is checked before use.
(function (root) {
  'use strict';
  const expected = {
    'g1.dat': { bytes: 37748736, numPoints: 1179648, remote: 'g1_compressed.dat' },
    'g2.dat': { bytes: 128, numPoints: 1, remote: 'g2.dat' },
    'grumpkin_g1.dat': { bytes: 4194368, numPoints: 65537, remote: 'grumpkin_g1_v2.dat' },
  };

  function validateManifest(manifest) {
    if (manifest?.schemaVersion !== 1 || manifest.aztecVersion !== '5.0.0' || !Array.isArray(manifest.files) || manifest.files.length !== 3) {
      throw new Error('Missing or incompatible build-pinned CRS manifest');
    }
    const files = new Map();
    for (const file of manifest.files) {
      const spec = expected[file?.name];
      if (!spec || files.has(file.name) || file.bytes !== spec.bytes || file.numPoints !== spec.numPoints
          || file.range?.start !== 0 || file.range?.end !== spec.bytes - 1
          || !/^[a-f0-9]{64}$/.test(file.sha256)
          || file.url !== 'https://crs.aztec-cdn.foundation/' + spec.remote
          || file.fallbackUrl !== 'https://crs.aztec-labs.com/' + spec.remote) {
        throw new Error('Invalid pinned CRS entry: ' + file?.name);
      }
      files.set(file.name, file);
    }
    return files;
  }

  async function readResponse(response, file) {
    if (!response.ok || (response.status !== 200 && response.status !== 206)) throw new Error('CRS HTTP ' + response.status);
    const declaredSize = response.headers.get('content-length');
    if (declaredSize !== null && Number(declaredSize) !== file.bytes) {
      await response.body?.cancel();
      throw new Error('CRS response size mismatch: ' + file.name);
    }
    if (!response.body) throw new Error('Empty CRS response: ' + file.name);
    const reader = response.body.getReader();
    const data = new Uint8Array(file.bytes);
    let offset = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (offset + value.byteLength > file.bytes) throw new Error('CRS response exceeds pinned size: ' + file.name);
        data.set(value, offset);
        offset += value.byteLength;
      }
      if (offset !== file.bytes) throw new Error('Truncated CRS response: ' + file.name);
      return data;
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }

  async function loadVerified({ manifest, loadLocal, sha256, fetch: fetchFn = root.fetch.bind(root), log = () => {} }) {
    const files = validateManifest(manifest);
    const loaded = {};
    for (const [name, file] of files) {
      async function verify(data) {
        if (!ArrayBuffer.isView(data) || data.BYTES_PER_ELEMENT !== 1 || data.byteLength !== file.bytes) {
          throw new Error('CRS size mismatch: ' + name);
        }
        if (await sha256(data) !== file.sha256) throw new Error('CRS SHA-256 mismatch: ' + name);
        return data;
      }
      try {
        loaded[name] = await verify(await loadLocal(file));
        log('Verified local ' + name, 'info');
        continue;
      } catch (error) {
        log('Local ' + name + ' unavailable or invalid (' + error.message + '); trying pinned CDN data.', 'warn');
      }
      let lastError;
      for (const url of [file.url, file.fallbackUrl]) {
        try {
          const response = await fetchFn(url, { headers: { Range: 'bytes=0-' + (file.bytes - 1) }, signal: AbortSignal.timeout(120000) });
          loaded[name] = await verify(await readResponse(response, file));
          log('Verified CDN ' + name, 'info');
          break;
        } catch (error) { lastError = error; }
      }
      if (!loaded[name]) throw new Error('No verified CRS data for ' + name + ': ' + lastError?.message);
    }
    return { files, data: loaded };
  }

  async function initialize(bb, options) {
    const { files, data } = await loadVerified(options);
    const numPoints = files.get('g1.dat').numPoints;
    const bn254 = await bb.srsInitSrs({ pointsBuf: data['g1.dat'], numPoints, g2Point: data['g2.dat'] });
    // Pinned v5 returns the decompressed points for a compressed input.
    if (!ArrayBuffer.isView(bn254?.pointsBuf) || bn254.pointsBuf.BYTES_PER_ELEMENT !== 1 || bn254.pointsBuf.byteLength !== numPoints * 64) {
      throw new Error('Unexpected BN254 SRS initialization response');
    }
    const grumpkin = await bb.srsInitGrumpkinSrs({ pointsBuf: data['grumpkin_g1.dat'], numPoints: files.get('grumpkin_g1.dat').numPoints });
    if (grumpkin?.dummy !== 0) throw new Error('Unexpected Grumpkin SRS initialization response');
  }

  const api = { validateManifest, readResponse, loadVerified, initialize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BillboardCRS = api;
})(globalThis);
