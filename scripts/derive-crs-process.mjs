import { spawn } from 'node:child_process';
import { ROOT } from './toolchain.mjs';

// The synchronous WASM operation cannot service an in-process timer. Keep its
// deadline in this parent and wait for OS process closure before accepting output.
export function runCrsChild(args, {
  timeoutMs = 600000, killWaitMs = 3000, signalSource = process, onSpawn = () => {},
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit', shell: false });
    let failure;
    let killTimer;
    let finished = false;
    const handlers = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => stop(new Error(`CRS derivation interrupted by ${signal}`))]));
    const cleanup = () => {
      clearTimeout(timer); clearTimeout(killTimer);
      for (const [signal, handler] of handlers) signalSource.removeListener(signal, handler);
    };
    const finish = error => {
      if (finished) return;
      finished = true; cleanup();
      if (error) reject(error); else resolve();
    };
    const stop = error => {
      if (finished || failure) return;
      failure = error;
      child.kill('SIGKILL');
      killTimer = setTimeout(() => {
        child.unref();
        finish(new AggregateError([failure], 'CRS derivation did not close after SIGKILL'));
      }, killWaitMs);
    };
    const timer = setTimeout(() => stop(new Error('CRS derivation timed out')), timeoutMs);
    for (const [signal, handler] of handlers) signalSource.on(signal, handler);
    child.once('error', error => { failure = error; });
    child.once('close', (code, signal) => finish(failure || (code !== 0 || signal ? new Error(`CRS derivation exited: ${signal || code}`) : undefined)));
    try { onSpawn(child); } catch (error) { stop(error); }
  });
}
