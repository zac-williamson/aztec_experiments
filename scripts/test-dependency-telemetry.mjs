import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';

const mode = process.argv[2];
const require = createRequire(import.meta.url);

async function fixture(mode) {
  // Each mode runs in a fresh process: OpenTelemetry registration is global.
  const { propagation, trace, ROOT_CONTEXT, defaultTextMapGetter } = await import('@opentelemetry/api');
  const { JaegerPropagator } = await import('@opentelemetry/propagator-jaeger');
  const { initTelemetryClient, getConfigEnvVars } = await import('@aztec/telemetry-client');
  const malformed = { 'uber-trace-id': '%', 'uberctx-local': '%' };
  if (mode === 'jaeger-resolution') {
    const parent = createRequire(require.resolve('@opentelemetry/sdk-trace-node'));
    const fromJaeger = createRequire(parent.resolve('@opentelemetry/propagator-jaeger'));
    assert.equal(parent('@opentelemetry/sdk-trace-node/package.json').version, '1.30.1');
    assert.equal(parent('@opentelemetry/propagator-jaeger/package.json').version, '2.9.0');
    assert.equal(parent('@opentelemetry/core/package.json').version, '1.30.1');
    assert.equal(fromJaeger('@opentelemetry/core/package.json').version, '2.9.0');
    assert.equal(parent.resolve('@opentelemetry/api'), fromJaeger.resolve('@opentelemetry/api'));
    return { parentMajorPreserved: true, jaegerOwnCore: '2.9.0', sharedApi: true };
  }
  if (mode === 'jaeger-malformed') {
    for (const carrier of [malformed, { 'uber-trace-id': ['%'] }, { 'uberctx-a': '%' },
      { 'uberctx-bad': '%', 'uberctx-good': 'harmless%20value' }]) {
      const extracted = new JaegerPropagator().extract(ROOT_CONTEXT, carrier, defaultTextMapGetter);
      assert.equal(trace.getSpanContext(extracted), undefined);
      assert.equal(propagation.getBaggage(extracted)?.getEntry('bad'), undefined);
      assert.equal(propagation.getBaggage(extracted)?.getEntry('a'), undefined);
      if (carrier['uberctx-good']) assert.equal(propagation.getBaggage(extracted).getEntry('good').value, 'harmless value');
    }
    return { malformedTraceAndBaggageIgnored: true, validSiblingPreserved: true };
  }
  if (mode === 'jaeger-roundtrip') {
    const { suppressTracing } = await import('@opentelemetry/core');
    const { defaultTextMapSetter } = await import('@opentelemetry/api');
    let ctx = trace.setSpanContext(ROOT_CONTEXT, { traceId: '11111111111111111111111111111111', spanId: '2222222222222222', traceFlags: 1 });
    ctx = propagation.setBaggage(ctx, propagation.createBaggage({ local: { value: 'tiny % value' } }));
    for (const [config, header, baggage] of [[undefined, 'uber-trace-id', 'uberctx-local'],
      [{ customTraceHeader: 'x-local-trace', customBaggageHeaderPrefix: 'localctx' }, 'x-local-trace', 'localctx-local']]) {
      const propagator = new JaegerPropagator(config);
      const carrier = {};
      propagator.inject(ctx, carrier, defaultTextMapSetter);
      assert.equal(carrier[header], '11111111111111111111111111111111:2222222222222222:0:01');
      assert.equal(carrier[baggage], 'tiny%20%25%20value');
      const extracted = propagator.extract(ROOT_CONTEXT, carrier, defaultTextMapGetter);
      assert.equal(trace.getSpanContext(extracted).spanId, '2222222222222222');
      assert.equal(propagation.getBaggage(extracted).getEntry('local').value, 'tiny % value');
      const suppressed = {};
      propagator.inject(suppressTracing(ctx), suppressed, defaultTextMapSetter);
      assert.equal(suppressed[header], undefined, 'core1 suppression is recognized by Jaeger nested core2');
      assert.equal(suppressed[baggage], 'tiny%20%25%20value');
    }
    return { defaultAndCustomRoundtrip: true, core1SuppressionHonored: true };
  }
  if (mode === 'sdk-parent-jaeger') {
    process.env.OTEL_PROPAGATORS = 'jaeger';
    const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
    const provider = new NodeTracerProvider();
    try {
      provider.register();
      assert.deepEqual(propagation.fields(), ['uber-trace-id']);
      assert.equal(trace.getSpanContext(propagation.extract(ROOT_CONTEXT, malformed)), undefined);
      const valid = propagation.extract(ROOT_CONTEXT, { 'uber-trace-id': '11111111111111111111111111111111:2222222222222222:0:01' });
      assert.equal(trace.getSpanContext(valid).spanId, '2222222222222222');
    } finally { await provider.shutdown(); propagation.disable(); }
    return { actualSdk130EnvironmentSelectedJaeger: true, malformedIgnored: true };
  }
  if (mode === 'preexisting-propagator-control') {
    assert.equal(propagation.setGlobalPropagator(new JaegerPropagator()), true);
    const client = await initTelemetryClient(getConfigEnvVars());
    assert.equal(client.isEnabled(), false);
    // No-op does not sanitize a global propagator; the actual decoder must now be fixed.
    assert.equal(trace.getSpanContext(propagation.extract(ROOT_CONTEXT, malformed)), undefined);
    assert.deepEqual(propagation.fields(), ['uber-trace-id']);
    await client.stop();
    propagation.disable();
    return { preinstalledGlobalSurvivesNoop: true, malformedIgnoredByPatchedDecoder: true };
  }
  let collector;
  let exports = 0;
  if (mode === 'enabled-w3c') {
    collector = createServer((request, response) => { request.resume(); request.on('end', () => { exports++; response.writeHead(200, { 'content-type': 'application/json' }); response.end('{}'); }); });
    await new Promise((resolve, reject) => { collector.once('error', reject); collector.listen(0, '127.0.0.1', resolve); });
  }
  let client;
  const originalExtract = JaegerPropagator.prototype.extract;
  let jaegerCalls = 0;
  JaegerPropagator.prototype.extract = function (...args) { jaegerCalls++; return originalExtract.apply(this, args); };
  try {
    const config = getConfigEnvVars();
    if (collector) config.tracesCollectorUrl = new URL(`http://127.0.0.1:${collector.address().port}/v1/traces`);
    client = await initTelemetryClient(config);
    assert.equal(client.isEnabled(), Boolean(collector));
    assert.equal(await initTelemetryClient(config), client, 'actual initialization is stable on repeated call');
    if (!collector) {
      assert.equal(client.extractPropagatedContext('%'), undefined);
      assert.equal(propagation.extract(ROOT_CONTEXT, malformed), ROOT_CONTEXT);
      assert.deepEqual(propagation.fields(), []);
    } else {
      assert.deepEqual(propagation.fields(), ['traceparent', 'tracestate']);
      const traceparent = '00-11111111111111111111111111111111-2222222222222222-01';
      const extracted = client.extractPropagatedContext(traceparent);
      assert.equal(trace.getSpanContext(extracted).traceId, '11111111111111111111111111111111');
      const carrier = { traceparent, ...malformed };
      Object.defineProperty(carrier, 'baggage', { enumerable: true, get() { throw new Error('W3C baggage must not be read by TraceContext-only policy'); } });
      const context = propagation.extract(ROOT_CONTEXT, carrier);
      assert.equal(trace.getSpanContext(context).spanId, '2222222222222222');
      assert.equal(propagation.getBaggage(context), undefined);
      assert.equal(trace.getSpanContext(client.extractPropagatedContext('%')), undefined);
      const outbound = {};
      propagation.inject(context, outbound);
      assert.equal(outbound.traceparent, traceparent);
      assert.deepEqual(Object.keys(outbound), ['traceparent']);
      const span = client.getTracer('local-fixture').startSpan('bounded-span');
      span.end();
      await client.flush();
      // No minimum-duration reliance: actual global propagation and provider startup are the target.
    }
    assert.equal(jaegerCalls, 0, 'malformed Jaeger headers never reached the decoder in tested startup');
    await client.stop();
    await client.stop();
    await client.flush();
    return { mode, enabled: Boolean(collector), jaegerCalls, fields: propagation.fields(), collectorRequests: exports };
  } finally {
    JaegerPropagator.prototype.extract = originalExtract;
    await client?.stop();
    propagation.disable();
    if (collector) {
      const closed = new Promise(resolve => collector.close(resolve));
      collector.closeAllConnections();
      await closed;
    }
  }
}

if (mode) {
  try {
    if (mode === 'host-metrics-network') {
      const fromMetrics = createRequire(require.resolve('@opentelemetry/host-metrics'));
      assert.equal(fromMetrics('systeminformation/package.json').version, '5.31.7');
      const network = fromMetrics('systeminformation/lib/network');
      const { getNetworkData } = require('../node_modules/@opentelemetry/host-metrics/build/src/stats/si.js');
      const actual = await getNetworkData();
      assert(Array.isArray(actual));
      assert(actual.every(x => typeof x.iface === 'string' && typeof x.rx_bytes === 'number' && typeof x.tx_bytes === 'number'));
      const original = network.networkStats;
      let called = 0;
      try {
        network.networkStats = async (...args) => { called++; assert.equal(args.length, 0); throw new Error('local fixture unavailable'); };
        assert.deepEqual(await getNetworkData(), []);
        assert.equal(called, 1, 'actual HostMetrics failure adapter invoked');
      } finally { network.networkStats = original; }
      console.log(JSON.stringify({ mode, actualShapeChecked: true, failureMappedToEmptyArray: true }));
    } else console.log(JSON.stringify(await fixture(mode)));
  } catch (error) { console.error(error); process.exitCode = 1; }
} else {
  for (const mode of ['noop', 'enabled-w3c', 'jaeger-resolution', 'jaeger-roundtrip', 'jaeger-malformed', 'sdk-parent-jaeger', 'preexisting-propagator-control', 'host-metrics-network']) {
    test(`actual telemetry ${mode} in isolated runtime`, { timeout: 35000 }, async () => {
      const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || '/tmp', LOG_LEVEL: 'silent', OTEL_PROPAGATORS: 'jaeger,baggage', OTEL_MIN_TRACE_DURATION_MS: '0' };
      const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url), mode], {
        env, timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      });
      const last = stdout.trim().split('\n').at(-1);
      assert.equal(typeof JSON.parse(last), 'object');
    });
  }
}
