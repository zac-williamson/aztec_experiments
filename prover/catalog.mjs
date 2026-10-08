import fs from 'node:fs/promises';
import {ClientCircuitArtifacts,BundleArtifactProvider} from '@aztec/noir-protocol-circuits-types/client/bundle';
import {ProtocolContractArtifact} from '@aztec/protocol-contracts/providers/bundle';
import {SchnorrInitializerlessAccountContractArtifact} from '@aztec/accounts/schnorr';
import {getDefaultStandardPreloadedContracts} from '@aztec/standard-contracts';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {circuitId} from '../shared/remote-prover-wire.mjs';
export async function loadCircuitCatalog(){
 const circuits=new Map(),provider=new BundleArtifactProvider();
 const add=async(name,bytecode,vk,abi)=>{const id=await circuitId(bytecode,vk);circuits.set(id,{functionName:name,bytecode,vk,abi});};
 for(const [name,artifact] of Object.entries(ClientCircuitArtifacts))await add(name,Buffer.from(artifact.bytecode,'base64'),(await provider.getCircuitVkByName(name)).keyAsBytes);
 const artifacts=[SchnorrInitializerlessAccountContractArtifact,...Object.values(ProtocolContractArtifact),...(await getDefaultStandardPreloadedContracts()).map(c=>c.artifact)];
 for(const file of ['../apps/src/billboard/billboard_artifact.json','../apps/src/billboard/private_fee_artifact.json'])artifacts.push(loadContractArtifact(JSON.parse(await fs.readFile(new URL(file,import.meta.url),'utf8'))));
 for(const artifact of artifacts)for(const fn of artifact.functions)if(fn.verificationKey)await add(artifact.name+':'+fn.name,fn.bytecode,Buffer.from(fn.verificationKey,'base64'),fn.abi);
 for(const file of ['../apps/src/billboard/billboard_artifact.json','../apps/src/billboard/private_fee_artifact.json']){
  const raw=JSON.parse(await fs.readFile(new URL(file,import.meta.url),'utf8'));
  for(const circuit of circuits.values())if(circuit.functionName.startsWith(raw.name+':'))circuit.abi=raw.functions.find(f=>f.name===circuit.functionName.split(':')[1]).abi;
 }

 return circuits;
}
