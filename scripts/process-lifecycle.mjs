import { spawn } from 'node:child_process';
import net from 'node:net';

function start(spec) {
  const child = spawn(spec.command, spec.args || [], spec.options || {});
  let exitResult;
  let closeResult;
  let resolveExit;
  let resolveClose;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  const closed = new Promise(resolve => { resolveClose = resolve; });
  function record(result) {
    if (exitResult === undefined) { exitResult = result; resolveExit(result); }
  }
  child.once('error', error => record({ error }));
  child.once('exit', (code, signal) => record({ code, signal }));
  child.once('close', (code, signal) => {
    record({ code, signal });
    closeResult = exitResult;
    resolveClose(closeResult);
  });
  return { child, exited, closed, get exitResult() { return exitResult; }, get closeResult() { return closeResult; } };
}

function bounded(promise, milliseconds, message, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      fn(value);
    };
    const abort = () => finish(reject, signal.reason);
    // Observe the raced promise even if cancellation already arrived, so a
    // later service exit cannot become an unhandled rejection.
    promise.then(value => finish(resolve, value), error => finish(reject, error));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(reject, new Error(message)), milliseconds);
  });
}

async function terminate(managed, graceMs, killWaitMs) {
  if (!managed || managed.closeResult !== undefined) return;
  managed.child.kill('SIGTERM');
  try {
    await bounded(managed.closed, graceMs, 'Graceful child termination timed out');
  } catch {
    managed.child.kill('SIGKILL');
    await bounded(managed.closed, killWaitMs, `Child ${managed.child.pid} did not close after SIGKILL`);
  }
}

function exitError(label, result) {
  return result.error || new Error(`${label} exited unexpectedly: ${result.signal || result.code}`);
}

// A directly managed, single-process service and test command. The production
// TXE uses TXE_WORKERS=1; no shell or detached subprocess is introduced here.
export async function runWithService({
  service, tests, probe, readyTimeoutMs = 60000, pollMs = 250,
  probeTimeoutMs = 1000, testTimeoutMs = 1200000,
  terminationGraceMs = 3000, killWaitMs = 3000,
  signalSource = process, onSpawn = () => {},
}) {
  const cancellation = new AbortController();
  const handlers = new Map(['SIGINT', 'SIGTERM'].map(name => [name, () => {
    const error = new Error(`Test run interrupted by ${name}`);
    error.exitCode = name === 'SIGINT' ? 130 : 143;
    cancellation.abort(error);
  }]));
  for (const [name, handler] of handlers) signalSource.on(name, handler);
  let runningService;
  let runningTests;
  let failure;
  try {
    runningService = start(service);
    onSpawn('service', runningService.child);
    const serviceFailed = runningService.exited.then(result => { throw exitError('Test service', result); });
    // Install a rejection observer immediately, even if probe setup throws.
    serviceFailed.catch(() => {});
    const deadline = Date.now() + readyTimeoutMs;
    for (;;) {
      if (runningService.exitResult !== undefined) throw exitError('Test service', runningService.exitResult);
      cancellation.signal.throwIfAborted();
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Test service readiness timed out');
      const ready = await bounded(Promise.race([Promise.resolve().then(probe), serviceFailed]),
        Math.min(remaining, probeTimeoutMs), 'Test service readiness probe timed out', cancellation.signal);
      if (ready) break;
      const pause = new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
      await bounded(Promise.race([pause, serviceFailed]), remaining, 'Test service readiness timed out', cancellation.signal);
    }
    if (runningService.exitResult !== undefined) throw exitError('Test service', runningService.exitResult);
    cancellation.signal.throwIfAborted();
    runningTests = start(tests);
    onSpawn('tests', runningTests.child);
    const result = await bounded(Promise.race([runningTests.exited, serviceFailed]),
      testTimeoutMs, 'Test command timed out', cancellation.signal);
    if (result.error || result.code !== 0 || result.signal) throw exitError('Test command', result);
  } catch (error) {
    failure = error;
  } finally {
    const cleanups = await Promise.allSettled([
      terminate(runningTests, terminationGraceMs, killWaitMs),
      terminate(runningService, terminationGraceMs, killWaitMs),
    ]);
    for (const [name, handler] of handlers) signalSource.removeListener(name, handler);
    const cleanupErrors = cleanups.filter(r => r.status === 'rejected').map(r => r.reason);
    if (cleanupErrors.length) failure = new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], 'Child process teardown failed');
  }
  if (cancellation.signal.aborted) {
    if (failure && failure !== cancellation.signal.reason) cancellation.signal.reason.cause = failure;
    throw cancellation.signal.reason;
  }
  if (failure) throw failure;
}

export function probeTcp(port, host = '127.0.0.1', timeoutMs = 500) {
  return new Promise(resolve => {
    const socket = net.connect(port, host);
    let done = false;
    const finish = ready => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
