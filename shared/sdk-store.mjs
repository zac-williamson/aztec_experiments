import { AztecIndexedDBStore } from '@aztec/kv-store/deprecated/indexeddb';
import { createLogger } from '@aztec/foundation/log';
// The pinned PXE package does not expose its storage schema as a public export.
// Import the exact installed metadata, included in the SDK provenance manifest.
import { PXE_DATA_SCHEMA_VERSION } from '../node_modules/@aztec/pxe/dest/storage/metadata.js';

export { PXE_DATA_SCHEMA_VERSION };

function address(value, length, field) {
  const text = typeof value === 'string' ? value : value?.toString();
  if (typeof text !== 'string' || !new RegExp(`^0x[0-9a-fA-F]{${length}}$`).test(text) || /^0x0+$/.test(text)) {
    throw new Error(`PXE storage requires a valid ${field}`);
  }
  return text.toLowerCase();
}

export function getPXEStoreIdentity(config, schemaVersion = PXE_DATA_SCHEMA_VERSION) {
  const name = 'pxe_data';
  if (!config || !Number.isSafeInteger(config.l1ChainId) || config.l1ChainId <= 0) {
    throw new Error('PXE storage requires the node L1 chain ID');
  }
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 0) throw new Error('Invalid PXE storage schema version');
  const rollup = address(config.rollupAddress, 40, 'rollup address');
  const account = address(config.accountAddress, 64, 'account address');
  const directory = config.dataDirectory;
  if (typeof directory !== 'string' || directory.length === 0 || directory.length > 512 || /[\u0000-\u001f\u007f]/.test(directory)) {
    throw new Error('PXE storage requires an explicit application data namespace');
  }
  // JSON encoding is unambiguous even when an operator's namespace contains
  // separators. Full account addresses prevent the former truncated-name alias.
  const identity = JSON.stringify(['billboard-pxe', 1, directory, name, config.l1ChainId, rollup, schemaVersion, account]);
  return Object.freeze({ name: identity, metadata: identity });
}

/** Open application PXE state with explicit network, account and schema identity.
 * A version change selects a different named store; no existing store is reset.
 */
export async function openPXEStore(config, schemaVersion = PXE_DATA_SCHEMA_VERSION, log = createLogger('billboard:pxe-store')) {
  const identity = getPXEStoreIdentity(config, schemaVersion);
  if (typeof globalThis.indexedDB?.databases !== 'function') {
    throw new Error('This browser cannot inspect existing PXE stores safely; use a supported browser before opening wallet storage');
  }
  const databases = await globalThis.indexedDB.databases();
  const existed = databases.some(db => db.name === identity.name);
  const store = await AztecIndexedDBStore.open(log, identity.name, false);
  try {
    const marker = store.openSingleton('billboardStoreIdentity');
    const stored = await marker.getAsync();
    if (stored !== undefined && stored !== identity.metadata) throw new Error('PXE storage identity mismatch; existing data has been preserved');
    if (existed && stored === undefined) throw new Error('Unrecognized PXE storage metadata; existing data has been preserved');
    if (stored === undefined) await marker.set(identity.metadata);
    return store;
  } catch (error) {
    await store.close();
    throw error;
  }
}
