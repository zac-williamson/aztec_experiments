import fs from 'node:fs';

// Keep the moderation CLI within the configured censor authority. The existing
// engine needs an Aztec account even to list posts; it must not borrow a user's
// ambient wallet merely to initialize that account context.
export function loadCliWalletInputs({ action, explicitCensorWallet, censorWalletPath, aztecWalletPath, ethWalletPath }, io = fs) {
  const censorOnly = ['declare-immoral', 'transfer-censor', 'set-moderation-policy'].includes(action) || (action === 'list' && explicitCensorWallet === true);
  function requiredWallet(filename, label) {
    if (typeof filename !== 'string' || !filename || !io.existsSync(filename)) throw new Error(`${label} wallet is required`);
    let wallet;
    try { wallet = JSON.parse(io.readFileSync(filename, 'utf8')); }
    catch { throw new Error(`${label} wallet could not be read`); }
    if (!wallet || typeof wallet !== 'object' || Array.isArray(wallet) || typeof wallet.secretKey !== 'string' || !wallet.secretKey) {
      throw new Error(`${label} wallet is missing its secret key`);
    }
    return wallet;
  }
  if (censorOnly) {
    const censorWallet = requiredWallet(censorWalletPath, 'Censor');
    return { ethWallet: null, aztecWallet: censorWallet, censorWalletJson: censorWallet };
  }
  let ethWallet = null;
  if (io.existsSync(ethWalletPath)) {
    try { ethWallet = JSON.parse(io.readFileSync(ethWalletPath, 'utf8')); }
    catch { throw new Error('ETH wallet could not be read'); }
  }
  return { ethWallet, aztecWallet: requiredWallet(aztecWalletPath, 'Aztec'), censorWalletJson: null };
}
