// TEST ONLY: real browser backup cryptography, fresh VM restore and actual SDK
// account derivation. No keys, password or ciphertext are written to evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto, randomBytes } from 'node:crypto';
import { Fr } from '@aztec/foundation/curves/bn254';
import { deriveMasterMessageSigningSecretKey } from '@aztec/stdlib/keys';
import { getSchnorrInitializerlessAccountContractAddress } from '@aztec/accounts/schnorr';

export async function restoreApplicationAuthor(generated) {
  // SDK testing accounts use independently random signing keys. The application
  // intentionally derives signing authority from its backed-up master secret.
  const initialSigningKey = deriveMasterMessageSigningSecretKey(generated.secret);
  const expectedAddress = await getSchnorrInitializerlessAccountContractAddress(initialSigningKey, generated.salt, generated.secret);
  const source = await fs.readFile(new URL('../shared/wallet-backup.js', import.meta.url), 'utf8');
  const context = () => {
    const runtime = vm.createContext({ crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array });
    vm.runInContext(source, runtime, { filename: 'shared/wallet-backup.js' });
    return runtime.BillboardWalletBackup;
  };
  const original = { secretKey: generated.secret.toString(), salt: generated.salt.toString() };
  const password = randomBytes(32).toString('hex');
  const encrypted = await context().encrypt({ schemaVersion: 1, wallet: original, claims: [] }, password);
  // JSON transport crosses into an independently initialized helper context.
  const restored = await context().decrypt(JSON.parse(JSON.stringify(encrypted)), password);
  assert.equal(restored.wallet.secretKey, original.secretKey);
  assert.equal(restored.wallet.salt, original.salt);
  const secret = Fr.fromHexString(restored.wallet.secretKey);
  const salt = Fr.fromHexString(restored.wallet.salt);
  const signingKey = deriveMasterMessageSigningSecretKey(secret);
  const address = await getSchnorrInitializerlessAccountContractAddress(signingKey, salt, secret);
  assert(address.equals(expectedAddress), 'Restored application account address differs');
  return {
    author: { secret, salt, signingKey, address, type: 'schnorr_initializerless' },
    observation: { encryptedRoundTrip: true, freshRestoreContext: true, fullSaltPreserved: true,
      derivedSigningKeyFromRestoredSecret: true, sameApplicationAddress: true,
      applicationSigningDerivation: true, noIndependentTestSigningKeyReused: true },
  };
}
