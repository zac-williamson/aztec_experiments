import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { runWithService } from './process-lifecycle.mjs';
import { assertNodeVersion } from './toolchain.mjs';

assertNodeVersion();
const idle = "process.send('ready'); setInterval(() => {}, 1000);";
const stubborn = "process.on('SIGTERM', () => {}); " + idle;
const command = code => ({ command: process.execPath, args: ['-e', code], options: { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] } });

function fixture(overrides = {}) {
  const children = [];
  const signals = new EventEmitter();
  let ready = false;
  const options = {
    service: command(idle), tests: command('process.exit(0)'),
    probe: () => ready,
    // Ordinary process startup is not a latency benchmark. Explicit timeout
    // scenarios below retain their shorter tested deadlines.
    pollMs: 10, readyTimeoutMs: 10000, probeTimeoutMs: 500,
    testTimeoutMs: 10000, terminationGraceMs: 100, killWaitMs: 1000,
    signalSource: signals,
    ...overrides,
    onSpawn: (role, child) => {
      children.push({ role, child });
      child.on('message', message => { if (role === 'service' && message === 'ready') ready = true; });
      overrides.onSpawn?.(role, child, signals);
    },
  };
  return {
    options, children, signals,
    assertReaped() {
      for (const { child } of children) {
        if (child.pid) assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' }, 'managed child must no longer exist');
        assert.ok(child.exitCode !== null || child.signalCode !== null, 'child exit must be observed');
      }
      assert.equal(signals.listenerCount('SIGINT'), 0);
      assert.equal(signals.listenerCount('SIGTERM'), 0);
    },
  };
}

test('successful tests reap the service and remove signal handlers', async () => {
  const f = fixture();
  await runWithService(f.options);
  f.assertReaped();
  assert.equal(f.children.find(c => c.role === 'tests').child.exitCode, 0);
});

test('failed tests remain a failure and reap the service', async () => {
  const f = fixture({ tests: command('process.exit(7)') });
  await assert.rejects(runWithService(f.options), /Test command exited unexpectedly: 7/);
  f.assertReaped();
});

test('service death by signal during startup is detected before readiness timeout', async () => {
  let start;
  const f = fixture({
    service: command("process.on('message', () => process.kill(process.pid, 'SIGTERM')); " + idle),
    probe: () => false,
    onSpawn: (role, child) => child.once('message', message => {
      if (role === 'service' && message === 'ready') {
        start = Date.now();
        child.send('terminate');
      }
    }),
  });
  await assert.rejects(runWithService(f.options), /Test service exited unexpectedly: SIGTERM/);
  assert.equal(typeof start, 'number', 'service startup must be acknowledged before measuring exit detection');
  assert.ok(Date.now() - start < 2000);
  assert.equal(f.children.length, 1);
  f.assertReaped();
});

test('readiness deadline terminates a live unready service', async () => {
  const f = fixture({ probe: () => false, readyTimeoutMs: 100 });
  await assert.rejects(runWithService(f.options), /readiness timed out/);
  f.assertReaped();
});

test('a stuck readiness probe is bounded and its service is reaped', async () => {
  const f = fixture({ probe: () => new Promise(() => {}), probeTimeoutMs: 50 });
  await assert.rejects(runWithService(f.options), /readiness probe timed out/);
  f.assertReaped();
});

test('timed-out tests and service ignoring SIGTERM are forcibly killed and reaped', async t => {
  // Child startup is real and can be slow under concurrent compiler load. Hold
  // the lifecycle clock until both IPC acknowledgments prove their SIGTERM
  // handlers are installed, then exercise the actual timeout/kill path.
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let serviceReady, testsReady;
  const serviceStarted = new Promise(resolve => { serviceReady = resolve; });
  const testsStarted = new Promise(resolve => { testsReady = resolve; });
  const f = fixture({
    service: command(stubborn), tests: command(stubborn), testTimeoutMs: 200,
    probe: () => serviceStarted,
    onSpawn: (role, child) => child.once('message', message => {
      if (message === 'ready') (role === 'service' ? serviceReady : testsReady)(true);
    }),
  });
  let watchdog;
  const deadline = new Promise((_, reject) => {
    watchdog = realSetTimeout(() => reject(new Error('Stubborn-child readiness/teardown exceeded 10 seconds')), 10000);
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const running = runWithService(f.options);
  // Observe rejection immediately while waiting for the real child messages.
  running.catch(() => {});
  try {
    await Promise.race([Promise.all([serviceStarted, testsStarted]), deadline]);
    t.mock.timers.tick(200);
    // Allow the rejected timeout to enter teardown and install the grace timer.
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(100);
    await Promise.race([assert.rejects(running, /Test command timed out/), deadline]);
    f.assertReaped();
    for (const { child } of f.children) assert.equal(child.signalCode, 'SIGKILL');
  } finally {
    realClearTimeout(watchdog);
    t.mock.timers.reset();
    // Keep a failed startup assertion from leaving a real disposable child alive.
    for (const { child } of f.children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    f.options.signalSource.emit('SIGTERM');
    await running.catch(() => {});
  }
});

test('SIGTERM during startup produces exit code 143 and reaps children', async () => {
  const f = fixture({
    probe: () => false,
    onSpawn: (role, child, signals) => child.once('message', () => signals.emit('SIGTERM')),
  });
  await assert.rejects(runWithService(f.options), error => error.exitCode === 143 && /SIGTERM/.test(error.message));
  f.assertReaped();
});

test('SIGINT during test execution produces exit code 130 and reaps both children', async () => {
  const f = fixture({
    tests: command(stubborn),
    onSpawn: (role, child, signals) => { if (role === 'tests') child.once('message', () => signals.emit('SIGINT')); },
  });
  await assert.rejects(runWithService(f.options), error => error.exitCode === 130 && /SIGINT/.test(error.message));
  assert.equal(f.children.length, 2);
  f.assertReaped();
});

test('cancellation immediately after test spawn does not leave an unhandled exit rejection', async () => {
  const f = fixture({
    tests: command(idle),
    onSpawn: (role, child, signals) => { if (role === 'tests') signals.emit('SIGTERM'); },
  });
  await assert.rejects(runWithService(f.options), error => error.exitCode === 143);
  f.assertReaped();
});

test('service death while tests are active aborts and reaps those tests', async () => {
  const f = fixture({
    tests: command(idle),
    onSpawn: (role, child) => { if (role === 'tests') child.once('message', () => f.children[0].child.kill('SIGTERM')); },
  });
  await assert.rejects(runWithService(f.options), /Test service exited unexpectedly: SIGTERM/);
  f.assertReaped();
});

test('service spawn failure is surfaced without leaving signal handlers', async () => {
  const f = fixture({ service: { command: '/definitely-missing-billboard-fixture-command' } });
  await assert.rejects(runWithService(f.options), { code: 'ENOENT' });
  assert.equal(f.signals.listenerCount('SIGINT'), 0);
  assert.equal(f.signals.listenerCount('SIGTERM'), 0);
});

test('test spawn failure still reaps its service', async () => {
  const f = fixture({ tests: { command: '/definitely-missing-billboard-fixture-command' } });
  await assert.rejects(runWithService(f.options), { code: 'ENOENT' });
  assert.throws(() => process.kill(f.children[0].child.pid, 0), { code: 'ESRCH' });
});
