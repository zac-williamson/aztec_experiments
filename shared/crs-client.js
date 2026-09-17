// Shared browser/Node CRS loading. The manifest comes from the source build,
// never from a cache or CDN. Every local and remote byte is checked before use.
(function (root) {
  'use strict';
  const expected = {
    'g1.dat': { bytes: 37748736, numPoints: 1179648, remote: 'g1_compressed.dat', format: 'bn254-g1-compressed-32-byte' },
    'g2.dat': { bytes: 128, numPoints: 1, remote: 'g2.dat', format: 'bn254-g2-uncompressed-128-byte' },
    'grumpkin_g1.dat': { bytes: 4194368, numPoints: 65537, remote: 'grumpkin_g1_v2.dat', format: 'grumpkin-g1-v2-uncompressed-64-byte' },
  };
  const hasKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

  function validateManifest(manifest) {
    if (manifest?.schemaVersion !== 2 || manifest.aztecVersion !== '5.2.0' || !Array.isArray(manifest.files) || manifest.files.length !== 3) {
      throw new Error('Missing or incompatible build-pinned CRS manifest');
    }
    const files = new Map();
    for (const file of manifest.files) {
      const spec = expected[file?.name];
      if (!spec || files.has(file.name) || file.bytes !== spec.bytes || file.numPoints !== spec.numPoints || file.format !== spec.format
          || file.range?.start !== 0 || file.range?.end !== spec.bytes - 1
          || !/^[a-f0-9]{64}$/.test(file.sha256)
          || file.url !== 'https://crs.aztec-cdn.foundation/' + spec.remote
          || file.fallbackUrl !== 'https://crs.aztec-labs.com/' + spec.remote) {
        throw new Error('Invalid pinned CRS entry: ' + file?.name);
      }
      files.set(file.name, Object.freeze({ ...file, range: Object.freeze({ ...file.range }) }));
    }
    const derived = manifest.derivedG1;
    const provenance = derived?.derivation;
    if (!hasKeys(derived, ['name', 'bytes', 'numPoints', 'format', 'sha256', 'derivation'])
      || derived.name !== 'g1_uncompressed.dat' || derived.bytes !== 75497472
      || derived.numPoints !== files.get('g1.dat').numPoints || derived.format !== 'bn254-g1-uncompressed-64-byte'
      || !/^[a-f0-9]{64}$/.test(derived.sha256)
      || !hasKeys(provenance, ['method', 'packageVersion', 'inputName', 'inputSha256', 'g2Sha256', 'wasmSource', 'wasmSha256'])
      || provenance.method !== 'bb-srs-init-v1' || provenance.packageVersion !== manifest.aztecVersion
      || provenance.inputName !== 'g1.dat' || provenance.inputSha256 !== files.get('g1.dat').sha256
      || provenance.g2Sha256 !== files.get('g2.dat').sha256
      || provenance.wasmSource !== 'node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz'
      || provenance.wasmSha256 !== '9106f6164e4714a87ce1cf13ceac4d22109767a16e6fb997f1af7e7fcc81ae45') {
      throw new Error('Invalid pinned CRS entry: derivedG1');
    }
    return { files, derivedG1: Object.freeze({ ...derived, derivation: Object.freeze({ ...provenance }) }) };
  }

  async function readResponse(response, file) {
    if (!response.ok || (response.status !== 200 && response.status !== 206)) {
      // A rejected response may still have a streaming body. Release it before
      // the caller starts its next verified local/CDN fallback.
      await response.body?.cancel().catch(() => {});
      throw new Error('CRS HTTP ' + response.status);
    }
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
    const { files, derivedG1 } = validateManifest(manifest);
    const loaded = {};
    async function verify(data, file) {
      if (!ArrayBuffer.isView(data) || data.BYTES_PER_ELEMENT !== 1 || data.byteLength !== file.bytes) {
        throw new Error('CRS size mismatch: ' + file.name);
      }
      if (await sha256(data) !== file.sha256) throw new Error('CRS SHA-256 mismatch: ' + file.name);
      return data;
    }
    let selectedG1 = files.get('g1.dat');
    try {
      loaded[derivedG1.name] = await verify(await loadLocal(derivedG1), derivedG1);
      selectedG1 = derivedG1;
      log('Verified local ' + derivedG1.name, 'info');
    } catch (error) {
      log('Local derived G1 unavailable or invalid (' + error.message + '); using verified compressed data.', 'warn');
    }
    for (const [name, file] of files) {
      if (name === 'g1.dat' && selectedG1 === derivedG1) continue;
      try {
        loaded[name] = await verify(await loadLocal(file), file);
        log('Verified local ' + name, 'info');
        continue;
      } catch (error) {
        log('Local ' + name + ' unavailable or invalid (' + error.message + '); trying pinned CDN data.', 'warn');
      }
      let lastError;
      for (const url of [file.url, file.fallbackUrl]) {
        try {
          const response = await fetchFn(url, { headers: { Range: 'bytes=0-' + (file.bytes - 1) }, signal: AbortSignal.timeout(120000) });
          loaded[name] = await verify(await readResponse(response, file), file);
          log('Verified CDN ' + name, 'info');
          break;
        } catch (error) { lastError = error; }
      }
      if (!loaded[name]) throw new Error('No verified CRS data for ' + name + ': ' + lastError?.message);
    }
    return { files, data: loaded, selectedG1 };
  }

  async function initialize(bb, options) {
    const requestedPoints=options.bn254NumPoints;
    if(requestedPoints!==undefined && (!Number.isSafeInteger(requestedPoints)||requestedPoints<=0))throw new Error('Invalid BN254 initialization point budget');
    const { files, data, selectedG1 } = await loadVerified(options);
    const numPoints=requestedPoints===undefined?selectedG1.numPoints:requestedPoints;
    if(numPoints>selectedG1.numPoints)throw new Error('BN254 initialization exceeds verified source capacity');
    // A prefix is usable only AFTER the complete pinned source has passed its
    // size/hash verification. Match the exact count and wire format for BB.
    const bytesPerPoint=selectedG1.format==='bn254-g1-uncompressed-64-byte'?64:32;
    const pointsBuf=numPoints===selectedG1.numPoints?data[selectedG1.name]:data[selectedG1.name].subarray(0,numPoints*bytesPerPoint);
    const bn254 = await bb.srsInitSrs({ pointsBuf, numPoints, g2Point: data['g2.dat'] });
    // Pinned v5 returns decompressed points only for compressed input. Derived
    // input bypasses decompression, after our mandatory whole-content hash check.
    const responseBytes = selectedG1.format === 'bn254-g1-uncompressed-64-byte' ? 0 : numPoints * 64;
    if (!ArrayBuffer.isView(bn254?.pointsBuf) || bn254.pointsBuf.BYTES_PER_ELEMENT !== 1 || bn254.pointsBuf.byteLength !== responseBytes) {
      throw new Error('Unexpected BN254 SRS initialization response');
    }
    const grumpkin = await bb.srsInitGrumpkinSrs({ pointsBuf: data['grumpkin_g1.dat'], numPoints: files.get('grumpkin_g1.dat').numPoints });
    if (grumpkin?.dummy !== 0) throw new Error('Unexpected Grumpkin SRS initialization response');
    return { g1Format: selectedG1.format, sourceBn254NumPoints: selectedG1.numPoints, initializedBn254NumPoints: numPoints, grumpkinNumPoints: files.get('grumpkin_g1.dat').numPoints };
  }

  const api = { validateManifest, readResponse, loadVerified, initialize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BillboardCRS = api;
})(globalThis);
