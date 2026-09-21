// Versioned passkey PRF derivation. This is a Schnorr account, not a WebAuthn
// signature-verifying contract. Persist only the credential id and public address.
(function (global) {
  'use strict';
  const domain = 'aztec-billboard/passkey/v1';
  const field = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const encode = value => new TextEncoder().encode(value);
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const digest = value => crypto.subtle.digest('SHA-256', encode(value));
  function account(value) {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw Error('Invalid Ethereum account.');
    return value.toLowerCase();
  }
  function encodeId(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }
  function decodeId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(value)) throw Error('Invalid passkey record.');
    return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  }
  async function derive(prf, ethereumAccount) {
    const bytes = new Uint8Array(prf);
    if (bytes.byteLength !== 32) throw Error('This passkey does not support private account recovery (PRF).');
    const identity = account(ethereumAccount);
    const key = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveBits']);
    async function deriveField(label) {
      const result = new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',
        salt:await digest(domain),info:encode(domain + '/' + identity + '/' + label)}, key, 384));
      // 384 bits reduced into the field: negligible statistical bias, no retries.
      const value = BigInt('0x' + hex(result)) % field;
      result.fill(0);
      if (value === 0n) throw Error('Invalid passkey-derived account.');
      return '0x' + value.toString(16).padStart(64, '0');
    }
    return {secretKey:await deriveField('secret'),salt:await deriveField('salt')};
  }
  async function ceremony(ethereumAccount, {create = false, credentialId} = {}) {
    const identity = account(ethereumAccount);
    if (!global.isSecureContext || !navigator.credentials || !global.PublicKeyCredential) {
      throw Error('Passkeys require a supported browser and HTTPS.');
    }
    const userId = crypto.getRandomValues(new Uint8Array(32));
    const prfInput = await digest(domain + '/prf');
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const common = {challenge,timeout:120000,extensions:{prf:{eval:{first:prfInput}}}};
    let credential;
    if (create) {
      credential = await navigator.credentials.create({publicKey:{...common,
        rp:{id:location.hostname,name:'Anonymous Message Board'},
        user:{id:userId,name:identity,displayName:'Message board ' + identity.slice(0,8)},
        pubKeyCredParams:[{type:'public-key',alg:-7}],attestation:'none',
        authenticatorSelection:{residentKey:'required',userVerification:'required'},
      }});
    } else {
      credential = await navigator.credentials.get({publicKey:{...common,rpId:location.hostname,
        userVerification:'required',...(credentialId ? {allowCredentials:[{type:'public-key',id:decodeId(credentialId)}]} : {}),
      }});
    }
    if (!credential || credential.type !== 'public-key') throw Error('Passkey approval was not completed.');
    const id = encodeId(credential.rawId);
    if (credentialId && id !== credentialId) throw Error('The selected passkey does not match this account.');
    // Some authenticators enable PRF at registration but return its value only
    // during authentication. This is the same credential, never a substitute key.
    let output = credential.getClientExtensionResults().prf?.results?.first;
    if (create && !output && credential.getClientExtensionResults().prf?.enabled === true) {
      return ceremony(identity, {credentialId:id});
    }
    if (!output) throw Error('This passkey does not support private account recovery (PRF). Use a PRF-capable passkey.');
    try { return {wallet:await derive(output,identity),credentialId:id}; }
    finally { new Uint8Array(output).fill(0); }
  }
  global.BillboardPasskey = Object.freeze({derive,ceremony});
})(globalThis);
