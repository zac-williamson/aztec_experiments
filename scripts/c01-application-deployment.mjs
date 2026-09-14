// TEST ONLY: official SDK local deployment fixture; protocol proofs are outside this test.
import assert from 'node:assert/strict';
import {deployAztecL1Contracts} from '@aztec/ethereum/deploy-aztec-l1-contracts';
import {getL1ContractsConfigEnvVars} from '@aztec/ethereum/config';
import {getVKTreeRoot} from '@aztec/noir-protocol-circuits-types/vk-tree';
import {protocolContractsHash} from '@aztec/protocol-contracts';
export async function deployC01ApplicationProtocol({rpcUrl,privateKey,config,genesisArchiveRoot,fundingNeeded}){
  const url=new URL(rpcUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(config.l1ChainId,31337);
  const defaults=getL1ContractsConfigEnvVars();
  const settings=Object.fromEntries(Object.keys(defaults).map(key=>[key,config[key]??defaults[key]]));
  try{
    const deployment=await deployAztecL1Contracts(rpcUrl,privateKey,31337,{
      ...settings,initialValidators:config.initialValidators,genesisArchiveRoot,
      feeJuicePortalInitialBalance:fundingNeeded,vkTreeRoot:getVKTreeRoot(),protocolContractsHash,realVerifier:false,
    });
    return {deployment,observation:{passed:true,profile:'official SDK local application fixture',
      realVerifier:false,networkProofs:false,rollupVersion:String(deployment.rollupVersion),
      addresses:Object.fromEntries(Object.entries(deployment.l1ContractAddresses).map(([key,value])=>[key,value.toString()]))}};
  }catch(error){
    // SDK deployment exceptions can include fresh signing keys; retain only type.
    const failure=new Error('Application fixture deployment failed');
    failure.deploymentObservation={passed:false,errorClass:error?.name};throw failure;
  }
}
