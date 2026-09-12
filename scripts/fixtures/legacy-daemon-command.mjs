// HISTORICAL BAD CONSTRUCTION FIXTURE. Never import child_process here.
// Preserved functions are wrapped with mandatory injected capture-only execution.
// Production code must never import this module.
export function legacyCommandFixture(CONFIG, capture) {
  if (typeof capture !== 'function') throw new Error('Capture function required');
  const execSync = capture;
  const log = () => {};
function cliBaseArgs() {
  if (!CONFIG.portalAddress) throw new Error('--portal-address is required');
  const a = ['--portal-address', CONFIG.portalAddress, '--censor-wallet', CONFIG.censorWallet];
  if (CONFIG.aztecNodeUrl !== 'https://v5.mainnet.rpc.aztec-labs.com') {
    a.push('--node-url', CONFIG.aztecNodeUrl);
  }
  return a;
}

function runCli(actionArgs) {
  const allArgs = [actionArgs[0], ...cliBaseArgs(), ...actionArgs.slice(1)];
  log('  $ node cli.mjs ' + allArgs.join(' '), 'dim');
  try {
    return execSync(`node "${CONFIG.cliPath}" ${allArgs.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`, {
      encoding: 'utf8',
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    throw new Error('CLI failed: ' + (e.message || '') + '\n' + out.substring(0, 500));
  }
}

  return runCli;
}
