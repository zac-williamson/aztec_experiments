// Run the actual CLI cache identity block against the pinned account constructor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {GrumpkinScalar} from '@aztec-labs/foundation/curves/grumpkin';
import {deriveKeys,deriveMasterMessageSigningSecretKey as deriveSigningKey} from '@aztec-labs/stdlib/keys';
import {getContractInstanceFromInstantiationParams} from '@aztec-labs/aztec.js/contracts';
import {SchnorrInitializerlessAccountContract,getSchnorrInitializerlessAccountContractAddress} from '@aztec-labs/accounts/schnorr';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
const source=await fs.readFile(new URL('../apps/src/billboard/user/cli.mjs',import.meta.url),'utf8');
const start=source.indexOf('    const sk = a.Fr.fromHexString(aztecWallet.secretKey);'),end=source.indexOf('    const node = a.createAztecNodeClient(AZTEC_NODE_URL);',start);assert(start>0&&end>start);
const derive=new (Object.getPrototypeOf(async function(){}).constructor)('a','aztecWallet',source.slice(start,end)+'return account;');
const a={Fr,GrumpkinScalar,deriveKeys,deriveSigningKey,getContractInstanceFromInstantiationParams,SchnorrInitializerlessAccountContract};
test('CLI cache and account execution retain both explicit and derived signing identities',async()=>{
 try{
  const secret=Fr.random(),salt=Fr.random(),explicit=GrumpkinScalar.random();
  const derived=await getSchnorrInitializerlessAccountContractAddress(deriveSigningKey(secret),salt,secret);
  const explicitAddress=await getSchnorrInitializerlessAccountContractAddress(explicit,salt,secret);assert.notEqual(String(explicitAddress),String(derived));
  const wallet={secretKey:String(secret),salt:String(salt)};
  assert.equal(await derive(a,wallet),String(derived));
  assert.equal(await derive(a,{...wallet,signingKey:String(explicit)}),String(explicitAddress));
 }finally{BarretenbergSync.destroySingleton();}
});
