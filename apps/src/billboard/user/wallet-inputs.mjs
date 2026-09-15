import fs from 'node:fs';
const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const SECP = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
function key(value, maximum, label) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value) || BigInt(value) <= 0n || BigInt(value) >= maximum) throw new Error(`Invalid ${label} key`);
  return value.toLowerCase();
}
export function validateCliNetwork({ nodeUrl, ethRpcUrl }) {
  const endpoint = (value, label) => {
    if (typeof value !== 'string' || !value || value.length > 4096) throw new Error(`Explicit ${label} RPC URL is required`);
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
      return url.href;
    } catch { throw new Error(`Invalid ${label} RPC URL`); }
  };
  return Object.freeze({ nodeUrl: endpoint(nodeUrl, 'Aztec'), ethRpcUrl: endpoint(ethRpcUrl, 'Ethereum') });
}
export function loadCliWalletInputs({ action, explicitCensorWallet, censorWalletPath, aztecWalletPath, ethWalletPath }, io = fs) {
  const censorOnly = ['declare-immoral', 'transfer-censor', 'set-moderation-policy'].includes(action) || (action === 'list' && explicitCensorWallet === true);
  function readWallet(filename, label, ethereum = false) {
    if (typeof filename !== 'string' || !filename) throw new Error(`${label} wallet is required`);
    let fd, wallet;
    try {
      fd = io.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = io.fstatSync(fd);
      if (!stat.isFile() || stat.mode & 0o077 || stat.size > 16384) throw new Error();
      wallet = JSON.parse(io.readFileSync(fd, 'utf8'));
    } catch { throw new Error(`${label} wallet could not be read as a private regular file`); }
    finally { if (fd !== undefined) io.closeSync(fd); }
    if (!wallet || typeof wallet !== 'object' || Array.isArray(wallet)) throw new Error(`Invalid ${label} wallet`);
    if (ethereum) return Object.freeze({ ...wallet, privateKey: key(wallet.privateKey, SECP, 'Ethereum') });
    const secretKey = key(wallet.secretKey, FR, label);
    const salt = wallet.salt ?? 0;
    if (!((typeof salt === 'number' && Number.isSafeInteger(salt) && salt >= 0) ||
        (typeof salt === 'string' && /^(?:0x[0-9a-fA-F]{1,64}|0|[1-9][0-9]{0,76})$/.test(salt)))) throw new Error('Invalid wallet salt');
    const exactSalt = BigInt(salt);
    if (exactSalt >= FR) throw new Error('Invalid wallet salt');
    return Object.freeze({ ...wallet, secretKey, salt: '0x' + exactSalt.toString(16).padStart(64, '0') });
  }
  if (censorOnly) {
    const censorWallet = readWallet(censorWalletPath, 'Censor');
    return { ethWallet: null, aztecWallet: censorWallet, censorWalletJson: censorWallet };
  }
  const ethWallet = ethWalletPath ? readWallet(ethWalletPath, 'ETH', true) : null;
  return { ethWallet, aztecWallet: readWallet(aztecWalletPath, 'Aztec'), censorWalletJson: null };
}
