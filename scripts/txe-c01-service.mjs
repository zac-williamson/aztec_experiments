// Local test environment only. Unmodified TXE 5.2 has public version2/private version1.
// Configure consistent scope without removing the application's chain/version assertions.
import assert from 'node:assert/strict';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Fr } from '@aztec/foundation/curves/bn254';
import { createLogger } from '@aztec/foundation/log';
import { startHttpRpcServer } from '@aztec/foundation/json-rpc/server';
import { ROOT, assertNodeVersion, assertAztecPackages } from './toolchain.mjs';
assertNodeVersion(); assertAztecPackages();
assert.equal(process.env.TXE_WORKERS, '1');
process.env.HARDWARE_CONCURRENCY ??= '2';
// Published unbundled TXE loads account JSON without an import attribute.
// Supply only the Node-required JSON attribute for this pinned local artifact directory.
const artifactRoots = ['accounts', 'protocol-contracts', 'standard-contracts'].map(name => pathToFileURL(path.join(ROOT, 'node_modules/@aztec', name, 'artifacts/')).href);
registerHooks({ load(url, context, nextLoad) {
  if (artifactRoots.some(root => url.startsWith(root)) && url.endsWith('.json')) {
    return nextLoad(url, { ...context, importAttributes: { ...context.importAttributes, type: 'json' } });
  }
  return nextLoad(url, context);
} });
const base = path.join(ROOT, 'node_modules/@aztec/txe/dest');
const { TXEGlobalVariablesBuilder } = await import(pathToFileURL(path.join(base, 'state_machine/global_variable_builder.js')).href);
const { TXEDispatcher } = await import(pathToFileURL(path.join(base, 'index.js')).href);
const { TXEStateMachine } = await import(pathToFileURL(path.join(base, 'state_machine/index.js')).href);
const originalCreate = TXEStateMachine.create;
TXEStateMachine.create = async function (...args) {
  const machine = await originalCreate.apply(this,args);
  assert.equal(await machine.node.getChainId(),1);
  assert.equal(await machine.node.getVersion(),1);
  return machine;
};
const originalBuild = TXEGlobalVariablesBuilder.prototype.buildCheckpointGlobalVariables;
TXEGlobalVariablesBuilder.prototype.buildCheckpointGlobalVariables = async function (...args) {
  const values = await originalBuild.apply(this,args);
  assert.equal(values.chainId.toBigInt(),1n);
  assert.equal(values.version.toBigInt(),2n);
  return { ...values, version: new Fr(1) };
};
const disposals = new Set();
const originalDispose = TXEDispatcher.prototype.disposeSession;
TXEDispatcher.prototype.disposeSession = function (...args) {
  const pending = originalDispose.apply(this,args); disposals.add(pending);
  pending.then(()=>disposals.delete(pending),()=>disposals.delete(pending));
  return pending;
};
const { createTXERpcServer } = await import(pathToFileURL(path.join(base,'rpc_server.js')).href);
const rpc = await createTXERpcServer(createLogger('txe:c01'));
const server = await startHttpRpcServer(rpc,{ host:'127.0.0.1',port:Number(process.env.TXE_PORT),timeoutMs:300000 });
console.log(JSON.stringify({profile:'C01 consistent-scope TXE',chain:1,version:1,originalPublicVersion:2,realProofs:false,port:server.port}));
let stopping=false;
async function stop() {
  if(stopping)return; stopping=true;
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  await Promise.all([...disposals]);
  // Match upstream TXE service termination after closing owned connections/sessions.
  process.exit(0);
}
process.on('SIGTERM',()=>{void stop();});process.on('SIGINT',()=>{void stop();});
