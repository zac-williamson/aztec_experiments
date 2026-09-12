import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const docker = async args => (await execute('docker', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 })).stdout.trim();
const imagePattern = /^[a-zA-Z0-9][a-zA-Z0-9./_:-]*@sha256:[a-f0-9]{64}$/;
export const PROBE_IMAGE = 'docker.io/library/node@sha256:f22d6a1f082c02f292e86929b5b0442ac2e5eaf438a5dea9b1566601c3e05940';

export async function hashModel(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function integer(value, fallback, min, max, label) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`Invalid model ${label}`);
  return number;
}

export async function validateModelOptions(options) {
  if (!imagePattern.test(options.image || '')) throw new Error('Model image must include an immutable @sha256 digest');
  if (!/^[a-f0-9]{64}$/.test(options.modelSha256 || '')) throw new Error('Model SHA-256 is required');
  if (typeof options.modelPath !== 'string') throw new Error('A local model file is required');
  const modelPath = await fs.realpath(options.modelPath);
  if (/[\r\n,]/.test(modelPath) || !(await fs.stat(modelPath)).isFile()) throw new Error('Model must be one regular file with a Docker-safe path');
  if (await hashModel(modelPath) !== options.modelSha256) throw new Error('Model SHA-256 mismatch');
  return {
    image: options.image, modelPath, modelSha256: options.modelSha256,
    port: integer(options.port, 5090, 1024, 65535, 'port'),
    threads: integer(options.threads, 4, 1, 16, 'thread count'),
    ctxSize: integer(options.ctxSize, 4096, 512, 32768, 'context size'),
    memoryMiB: integer(options.memoryMiB, 4096, 512, 32768, 'memory limit'),
  };
}

function requireIsolation(condition, label) {
  if (!condition) throw new Error(`Model isolation check failed: ${label}`);
}

export function checkIsolation(container, network, options, expectedNetwork, imageEnv, proxy = false) {
  const host = container.HostConfig;
  requireIsolation(container.Config.User === '65532:65532', 'non-root identity');
  requireIsolation(host.ReadonlyRootfs === true && host.Privileged === false, 'read-only unprivileged root');
  requireIsolation(host.CapDrop?.includes('ALL') && !(host.CapAdd?.length), 'all capabilities dropped');
  requireIsolation(host.SecurityOpt?.includes('no-new-privileges'), 'no privilege escalation');
  requireIsolation(host.PidsLimit === 128 && host.Memory === options.memoryMiB * 1024 * 1024, 'resource limits');
  requireIsolation(host.NanoCpus === options.threads * 1e9, 'CPU limit');
  requireIsolation(!host.Devices?.length && !host.DeviceRequests?.length && !host.VolumesFrom?.length, 'no extra device or volume access');
  requireIsolation(!host.PidMode && (!host.IpcMode || host.IpcMode === 'private') && !host.UTSMode, 'private process namespaces');
  requireIsolation(host.NetworkMode === expectedNetwork && network.Internal === !proxy, 'expected network');
  requireIsolation(Object.keys(container.NetworkSettings.Networks).length === (proxy ? 2 : 1), 'network count');
  const bindings = host.PortBindings;
  if (proxy) requireIsolation(Object.keys(bindings || {}).length === 1 && bindings['8080/tcp']?.length === 1 &&
    bindings['8080/tcp'][0].HostIp === '127.0.0.1' && bindings['8080/tcp'][0].HostPort === String(options.port), 'loopback-only endpoint');
  else {
    requireIsolation(Object.keys(bindings || {}).length === 0, 'no model port publication');
    requireIsolation(JSON.stringify(host.Dns) === '["127.0.0.1"]', 'no external model DNS');
    requireIsolation(network.EnableIPv6 === false &&
      network.Options?.['com.docker.network.bridge.gateway_mode_ipv4'] === 'isolated', 'no host bridge address or IPv6');
    requireIsolation(container.NetworkSettings.Networks[expectedNetwork]?.Gateway === '' &&
      network.IPAM.Config.every(subnet => !subnet.Gateway), 'no model bridge gateway');
  }
  const binds = container.Mounts.filter(mount => mount.Type === 'bind');
  requireIsolation(binds.length === 1 && container.Mounts.every(mount => mount.Type === 'bind' || mount.Type === 'tmpfs') &&
    binds[0].Source === options.modelPath && binds[0].Destination === (proxy ? '/proxy/proxy.cjs' : '/model/model.gguf') && binds[0].RW === false, 'only intended file mounted read-only');
  requireIsolation(Object.keys(host.Tmpfs || {}).length === 1 &&
    host.Tmpfs['/tmp'] === 'rw,noexec,nosuid,size=268435456,mode=1777', 'bounded temporary filesystem');
  requireIsolation(container.Config.Image === options.image, 'digest-pinned image');
  const env = new Map(imageEnv.map(value => [value.slice(0, value.indexOf('=')), value]));
  env.set('HOME', 'HOME=/tmp');
  requireIsolation(JSON.stringify([...env.values()].sort()) === JSON.stringify([...container.Config.Env].sort()), 'image defaults and explicit HOME only');
  return true;
}

async function startContainer(options, entrypoint, args, healthPath) {
  const config = await validateModelOptions(options);
  // No pull or native build is implicit. The operator supplies a reviewed image.
  const image = JSON.parse(await docker(['image', 'inspect', config.image]))[0];
  const proxyImage = JSON.parse(await docker(['image', 'inspect', PROBE_IMAGE]))[0];
  const proxyPath = await fs.realpath(fileURLToPath(new URL('./model-runtime-proxy.cjs', import.meta.url)));
  const suffix = randomUUID();
  const name = `billboard-model-${suffix}`;
  const networkName = `${name}-net`;
  const proxyNetworkName = `${name}-proxy-net`;
  let networkCreated = false;
  let proxyNetworkCreated = false;
  let containerId;
  let proxyId;
  let stopping;
  const stop = () => stopping ||= (async () => {
    const failures = [];
    for (const command of [proxyId && ['rm', '--force', proxyId], containerId && ['rm', '--force', containerId],
      networkCreated && ['network', 'rm', networkName], proxyNetworkCreated && ['network', 'rm', proxyNetworkName]].filter(Boolean)) {
      try { await docker(command); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Owned model resources could not all be removed');
  })();
  try {
    await docker(['network', 'create', '--driver', 'bridge', '--internal', '--ipv6=false',
      '--opt', 'com.docker.network.bridge.gateway_mode_ipv4=isolated', networkName]);
    networkCreated = true;
    await docker(['network', 'create', '--driver', 'bridge', proxyNetworkName]);
    proxyNetworkCreated = true;
    containerId = await docker(['create', '--name', name, '--network', networkName,
      '--network-alias', 'model', '--dns', '127.0.0.1', '--user', '65532:65532', '--read-only',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '128',
      '--memory', `${config.memoryMiB}m`, '--cpus', String(config.threads),
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=268435456,mode=1777',
      '--mount', `type=bind,src=${config.modelPath},dst=/model/model.gguf,readonly`,
      '--env', 'HOME=/tmp', '--label', 'org.billboard.role=isolated-model',
      '--entrypoint', entrypoint, config.image, ...args]);
    const proxyConfig = { ...config, image: PROBE_IMAGE, modelPath: proxyPath, memoryMiB: 512, threads: 1 };
    proxyId = await docker(['create', '--name', `${name}-proxy`, '--network', proxyNetworkName,
      '--publish', `127.0.0.1:${config.port}:8080`, '--user', '65532:65532', '--read-only',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '128',
      '--memory', '512m', '--cpus', '1', '--tmpfs', '/tmp:rw,noexec,nosuid,size=268435456,mode=1777',
      '--mount', `type=bind,src=${proxyPath},dst=/proxy/proxy.cjs,readonly`, '--env', 'HOME=/tmp',
      '--label', 'org.billboard.role=model-transport', '--entrypoint', '/usr/local/bin/node',
      PROBE_IMAGE, '/proxy/proxy.cjs']);
    await docker(['network', 'connect', networkName, proxyId]);
    const inspect = async () => {
      const container = JSON.parse(await docker(['inspect', containerId]))[0];
      const network = JSON.parse(await docker(['network', 'inspect', networkName]))[0];
      const proxy = JSON.parse(await docker(['inspect', proxyId]))[0];
      const proxyNetwork = JSON.parse(await docker(['network', 'inspect', proxyNetworkName]))[0];
      checkIsolation(container, network, config, networkName, image.Config.Env || []);
      checkIsolation(proxy, proxyNetwork, proxyConfig, proxyNetworkName, proxyImage.Config.Env || [], true);
      requireIsolation(Object.hasOwn(proxy.NetworkSettings.Networks, networkName), 'proxy attached to model network');
      return { container, network, proxy, proxyNetwork, config, imageEnv: image.Config.Env || [] };
    };
    await inspect();
    await docker(['start', containerId]);
    await docker(['start', proxyId]);
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${config.port}${healthPath}`, { signal: AbortSignal.timeout(1500) });
        if (response.ok) { ready = true; await response.body?.cancel(); break; }
        await response.body?.cancel();
      } catch { /* The model may still be loading. */ }
      const state = JSON.parse(await docker(['inspect', '--format', '{{json .State}}', containerId]));
      if (!state.Running) throw new Error(`Isolated model exited during startup (code ${state.ExitCode})`);
      await delay(500);
    }
    if (!ready) throw new Error('Isolated model health check timed out');
    await inspect();
    return { port: config.port, containerId, proxyId, inspect, stop };
  } catch (error) {
    try { await stop(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Model startup and cleanup failed'); }
    throw error;
  }
}

export async function startModelRuntime(options) {
  const config = await validateModelOptions(options);
  return startContainer(config, '/app/llama-server', ['--model', '/model/model.gguf', '--host', '0.0.0.0',
    '--port', '8080', '--threads', String(config.threads), '--ctx-size', String(config.ctxSize)], '/health');
}

// Test fixture uses the same isolation profile with a fixed harmless Node image.
// This is not selectable by any production daemon CLI option or environment flag.
export async function startIsolationProbe({ probePath, port }) {
  return startContainer({ image: PROBE_IMAGE, modelPath: probePath, modelSha256: await hashModel(probePath), port,
    memoryMiB: 512, threads: 1 }, '/usr/local/bin/node', ['/model/model.gguf'], '/health');
}
