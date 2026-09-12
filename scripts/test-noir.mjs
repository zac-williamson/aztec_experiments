import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { runWithService, probeTcp } from './process-lifecycle.mjs';
import { ROOT, assertNodeVersion, assertAztecPackages, nargoBinary } from './toolchain.mjs';
import { checkArtifacts } from './check-artifacts.mjs';
assertNodeVersion(); assertAztecPackages(); checkArtifacts();
if (!fs.readFileSync(path.join(ROOT, 'billboard/target/billboard_contract-Billboard.json')).equals(fs.readFileSync(path.join(ROOT, 'apps/src/billboard/billboard_artifact.json')))) throw new Error('TXE target artifact differs from validated canonical artifact; rebuild contracts');
const reservation = net.createServer();
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
try {
  await runWithService({
    service: {
      command: process.execPath,
      args: ['node_modules/@aztec/txe/dest/bin/index.js'],
      options: { cwd: ROOT, stdio: 'inherit', env: { ...process.env, TXE_PORT: String(port), TXE_WORKERS: '1' } },
    },
    tests: {
      command: nargoBinary(),
      args: ['test', '--workspace', '--oracle-resolver', `http://127.0.0.1:${port}`, '--test-threads', '1', '--silence-warnings'],
      options: { cwd: path.join(ROOT, 'billboard'), stdio: 'inherit' },
    },
    probe: () => probeTcp(port),
  });
} catch (error) {
  console.error(error);
  process.exitCode = error.exitCode || 1;
}
