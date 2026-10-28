import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {FunctionSelector,getAllFunctionAbis} from '@aztec-labs/stdlib/abi';
import {SerializableContractInstance,computeContractAddressFromInstance} from '@aztec-labs/stdlib/contract';
import {PublicKeys} from '@aztec-labs/stdlib/keys';
import {DefaultAccountEntrypoint} from '@aztec-labs/entrypoints/account';
import {allToCompletion} from '@aztec-labs/foundation/promise';
import {ORDINARY_POST_GAS_PROFILE} from '../shared/ordinary-post-fees.mjs';
import {validatedPxeProve} from './pxe-validated-prove.mjs';
import {restoreNativePxe} from './patch-pxe-operation-guards.mjs';
const source=validatedPxeProve(restoreNativePxe(await fs.readFile(new URL('../node_modules/@aztec-labs/pxe/dest/pxe.js',import.meta.url),'utf8'),'dest/pxe.js'));
function method(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);}
test('state preparation resolves new registered classes and current ABI, preserving native discovery checks',async()=>{
 const classIds=[Fr.fromString(ORDINARY_POST_GAS_PROFILE.accountClassId),new Fr(901),new Fr(902)];
 const names=['SchnorrInitializerlessAccount','PrivateFPC','RollingBoard'];
 const instances=await Promise.all(classIds.map(async id=>{const instance=new SerializableContractInstance({version:2,salt:Fr.ONE,deployer:AztecAddress.ZERO,currentContractClassId:id,originalContractClassId:id,initializationHash:Fr.ONE,immutablesHash:Fr.ZERO,publicKeys:PublicKeys.default()});return {instance,address:await computeContractAddressFromInstance(instance)};}));
 const fn=name=>({name,functionType:'private',parameters:[],returnTypes:[],isInternal:false,isInitializer:false,isStatic:false});
 const artifacts=names.map((name,i)=>({name,functions:i===1?[fn('pay_fee')]:i===2?[fn('post'),fn('post_thread')]:[],nonDispatchPublicFunctions:[]}));
 const events=[],ctx={anchorBlockHeader:{},changeSetId:1},store={getContractInstance:async address=>instances.find(row=>row.address.equals(address))?.instance,getContractArtifact:async id=>artifacts[classIds.findIndex(value=>value.equals(id))]};
 const classService={getCurrentClassId:async address=>instances.find(row=>row.address.equals(address))?.instance.currentContractClassId};
 const Class=vm.runInNewContext(`(class {contractStore=store;contractClassService=classService;keyStore={};node={};operationQueue={runSynced:async fn=>fn(ctx)};contractSyncService={ensureContractSynced:async value=>events.push(value)};#getSimulatorForTx=()=>({});#executeUtility=()=>{};
 ${method('async #registeredSyncTarget(', '    prepareOrdinaryPostState(')}
 ${method('prepareOrdinaryPostState(', '    prefetchBoardClaimWitnesses(')}
 ${method('    prepareBoardActionState(', '\n    // Public API')}
 })`,{measureRollingProofPhase:(_name,work)=>work(),store,classService,ctx,events,computeContractAddressFromInstance,allToCompletion,SyncFr:Fr,SyncAddress:AztecAddress,SyncSelector:FunctionSelector,syncFunctionAbis:getAllFunctionAbis,SyncAccountEntrypoint:DefaultAccountEntrypoint,PrivateKernelOracle:class{async getUpdatedClassIdHints(){}}});
 const input={owner:instances[0].address,privateFee:instances[1].address,board:instances[2].address},pxe=new Class();
 await pxe.prepareOrdinaryPostState(input);assert.equal(events.length,3);assert.equal(events[1].functionToInvokeAfterSync.toString(),(await FunctionSelector.fromNameAndParameters('pay_fee',[])).toString());
 assert(events.every(row=>row.anchorBlockHeader===ctx.anchorBlockHeader&&row.changeSetId===1));
 await pxe.prepareBoardActionState({...input,method:'post_thread'});assert.equal(events.length,6);
 await assert.rejects(async()=>pxe.prepareBoardActionState({...input,method:'set_like'}),/Invalid Board state method/);
 instances[1].instance.currentContractClassId=new Fr(999);await assert.rejects(pxe.prepareOrdinaryPostState(input),/Invalid ordinary sync class/);instances[1].instance.currentContractClassId=classIds[1];
 artifacts[2].name='ForeignBoard';await assert.rejects(pxe.prepareOrdinaryPostState(input),/Invalid registered sync artifact/);artifacts[2].name='RollingBoard';
 const original=store.getContractInstance;store.getContractInstance=async address=>address.equals(input.board)?instances[1].instance:original(address);await assert.rejects(pxe.prepareOrdinaryPostState(input),/Invalid registered sync preimage/);
});
