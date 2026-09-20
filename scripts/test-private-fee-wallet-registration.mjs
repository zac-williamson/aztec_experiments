// Actual application wallet + pinned BaseWallet registration and FPC preparer.
// PXE persistence is a double; its account address derivation uses the actual SDK.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {BaseWallet} from '@aztec/wallet-sdk/base-wallet';
import {Fr} from '@aztec/foundation/curves/bn254';
import {BarretenbergSync} from '@aztec/bb.js';
import {CompleteAddress,AztecAddress} from '@aztec/aztec.js/addresses';
import {Gas,GasFees,GasSettings} from '@aztec/stdlib/gas';
import {deriveKeys} from '@aztec/stdlib/keys';
import {getContractInstanceFromInstantiationParams} from '@aztec/aztec.js/contracts';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {preparePrivateFeePayment,derivePrivateFeeInstance} from '../shared/private-fee-client.mjs';
const artifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../apps/src/billboard/private_fee_artifact.json',import.meta.url))));
const source=fs.readFileSync(new URL('../apps/src/billboard/user/engine.js',import.meta.url),'utf8');
after(async()=>{await BarretenbergSync.destroySingleton();});
function walletFixture(engineSource=source){
 const calls=[],pxe={registerContractClass:async value=>calls.push(['class',value]),registerContract:async instance=>{calls.push(['contract',instance]);return instance.address;},
  registerAccount:async(keys,partial)=>{calls.push(['account',keys]);return CompleteAddress.fromPublicKeysAndPartialAddress(keys.publicKeys,partial);}};
 const node={getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:5}),getContract:async()=>undefined};
 const c=vm.createContext({performance,});vm.runInContext(engineSource,c);
 const wallet=c.BillboardPrivateFeeRouting.createAztecWallet({BaseWallet},pxe,node,node,()=>{},Fr.ONE);
 return {wallet,node,calls};
}
test('preparing ownerless FPC through actual BaseWallet never registers it as the author account',async()=>{
 const f=walletFixture(),instance=await derivePrivateFeeInstance(artifact);
 const prepared=await preparePrivateFeePayment({wallet:f.wallet,node:f.node,owner:AztecAddress.fromFieldUnsafe(new Fr(42)),privateFeeAddress:instance.address,privateFeeArtifact:artifact,expectedChainId:'31337',expectedVersion:'5',
  gasSettings:new GasSettings(new Gas(100,200),new Gas(10,20),new GasFees(3n,5n),new GasFees(0n,0n)),claim:{amount:2000n,salt:new Fr(7),leafIndex:Fr.ZERO}});
 assert(prepared.paymentMethod);assert.equal(f.calls.filter(c=>c[0]==='account').length,0);
 assert.equal(f.calls.filter(c=>c[0]==='contract').length,1);assert.equal(f.calls.find(c=>c[0]==='contract')[1].address.toString(),instance.address.toString());
});

test('explicit registration keys still pass through actual BaseWallet and derive a matching account',async()=>{
 const f=walletFixture(),secret=new Fr(9),keys=await deriveKeys(secret);
 // The same contract class with explicit keys is sufficient to exercise actual key/address registration.
 const instance=await getContractInstanceFromInstantiationParams(artifact,{salt:Fr.ZERO,publicKeys:keys.publicKeys,constructorArgs:[]});
 await f.wallet.registerContract(instance,artifact,secret);
 assert.equal(f.calls.filter(c=>c[0]==='account').length,1);
 assert.deepEqual(f.calls.find(c=>c[0]==='account')[1].publicKeys.toBuffer(),keys.publicKeys.toBuffer());
});

test('the removed implicit-key override reproduces the actual BaseWallet address mismatch',async()=>{
 const oldSource=source.replace('      async getAccountFromAddress()',`      async registerContract(instance,artifact,keys){return super.registerContract(instance,artifact,keys ?? this._secretKey);}
      async getAccountFromAddress()`);
 const f=walletFixture(oldSource),instance=await derivePrivateFeeInstance(artifact);
 await assert.rejects(f.wallet.registerContract(instance,artifact),/does not match contract instance address/);
 assert.equal(f.calls.filter(c=>c[0]==='account').length,1);
});
