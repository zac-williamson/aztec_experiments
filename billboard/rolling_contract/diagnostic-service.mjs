// Counts-only observation for a bounded TXE diagnosis. Never use for application traffic.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { ROOT } from '../../scripts/toolchain.mjs';
const target = pathToFileURL(path.join(ROOT, 'node_modules/@aztec-labs/pxe/dest/contract_function_simulator/oracle/utility_execution_oracle.js')).href;
registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (url !== target) return loaded;
  const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
  return { ...loaded, source: `${source}
import { AsyncLocalStorage as G05DiagnosticScope } from 'node:async_hooks';
const g05Scope = new G05DiagnosticScope();
const g05OriginalDb = NoteService.prototype.getNotes;
NoteService.prototype.getNotes = async function (...args) {
  const result = await g05OriginalDb.apply(this, args);
  const scope = g05Scope.getStore();
  if (scope) scope.dbCount = result.length;
  return result;
};
const g05OriginalUtility = UtilityExecutionOracle.prototype.getNotes;
let g05Observed = 0;
UtilityExecutionOracle.prototype.getNotes = async function (...args) {
  const scope = { dbCount: null };
  return g05Scope.run(scope, async () => {
    const result = await g05OriginalUtility.apply(this, args);
    if (++g05Observed <= 16) console.log(JSON.stringify({ diagnostic: 'G05-note-counts', dbCount: scope.dbCount, pickedCount: result.data.length, limit: args[12], offset: args[13] }));
    return result;
  });
};
` };
} });
await import('../../scripts/txe-c01-service.mjs');
