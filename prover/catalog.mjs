import {CircuitKind} from '@aztec-foundation/bb.js';
import fs from 'node:fs/promises';
import {ClientCircuitArtifacts,BundleArtifactProvider} from '@aztec-labs/noir-protocol-circuits-types/client/bundle';
import {ProtocolContractArtifact} from '@aztec-labs/protocol-contracts/providers/bundle';
import {SchnorrInitializerlessAccountContractArtifact} from '@aztec-labs/accounts/schnorr';
import {AuthRegistryArtifact,HandshakeRegistryArtifact,MultiCallEntrypointArtifact,PublicChecksArtifact} from '@aztec-labs/standard-contracts';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {circuitId} from '../shared/remote-prover-wire.mjs';
export async function loadCircuitCatalog(){
 const circuits=new Map(),provider=new BundleArtifactProvider();
 const add=async(name,bytecode,vk,abi,kind=CircuitKind.App)=>{const id=await circuitId(bytecode,vk);circuits.set(id,{functionName:name,bytecode,vk,abi,kind});};
 for(const [name,artifact] of Object.entries(ClientCircuitArtifacts))await add(name,Buffer.from(artifact.bytecode,'base64'),(await provider.getCircuitVkByName(name)).keyAsBytes,undefined,['HidingKernelToRollup','HidingKernelToPublic'].includes(name)?CircuitKind.HidingKernel:CircuitKind.Kernel);
 const artifacts=[SchnorrInitializerlessAccountContractArtifact,...Object.values(ProtocolContractArtifact),AuthRegistryArtifact,HandshakeRegistryArtifact,MultiCallEntrypointArtifact,PublicChecksArtifact];
 for(const file of ['../apps/src/billboard/billboard_artifact.json','../apps/src/billboard/private_fee_artifact.json','../plugins/adapter_artifact.json'])artifacts.push(loadContractArtifact(JSON.parse(await fs.readFile(new URL(file,import.meta.url),'utf8'))));
 for(const artifact of artifacts)for(const fn of artifact.functions)if(fn.verificationKey)await add(artifact.name+':'+fn.name,fn.bytecode,Buffer.from(fn.verificationKey,'base64'),fn.abi);
 for(const file of ['../apps/src/billboard/billboard_artifact.json','../apps/src/billboard/private_fee_artifact.json','../plugins/adapter_artifact.json']){
  const raw=JSON.parse(await fs.readFile(new URL(file,import.meta.url),'utf8'));
  for(const circuit of circuits.values())if(circuit.functionName.startsWith(raw.name+':'))circuit.abi=raw.functions.find(f=>f.name===circuit.functionName.split(':')[1]).abi;
 }

 const account=JSON.parse(await fs.readFile(new URL('../../artifacts/SchnorrInitializerlessAccount.json',import.meta.resolve('@aztec-labs/accounts/schnorr')),'utf8'));
 for(const circuit of circuits.values())if(circuit.functionName.startsWith(account.name+':'))circuit.abi=account.functions.find(f=>f.name===circuit.functionName.split(':')[1]).abi;
 return circuits;
}
