import {createHash} from 'node:crypto';
import {preservePxeSimulationLogs} from './pxe-simulation-logs.mjs';
export const SELECTED_NOTE_PINS=Object.freeze({
 'node_modules/@aztec-labs/pxe/dest/contract_function_simulator/contract_function_simulator.js':'f1a9aa049431f5946b6c1a208ce0d7e62bc090f734a9adfe2f47f9c9330ef2b3',
 'node_modules/@aztec-labs/aztec.js/dest/contract/contract_function_interaction.js':'3dc5bfd4dd0b2a7ce16a39ad6f5d6e9a5213c0bde0aa7e9e0755a16c17cb88a4',
});
// Optional metadata describes only the native notes selected by this successful
// utility. It authorizes nothing: private execution still verifies membership.
export function selectedNoteWitnesses(source,path){
 if(!Object.hasOwn(SELECTED_NOTE_PINS,path)||createHash('sha256').update(source).digest('hex')!==SELECTED_NOTE_PINS[path])throw Error('Selected note witness source mismatch');
 const replace=(before,after)=>{if(source.split(before).length!==2)throw Error('Selected note witness boundary mismatch');source=source.replace(before,after);};
 if(path.endsWith('/contract_function_interaction.js')){
  replace('                    stats: utilityResult.stats,','                    ...(utilityResult.noteHashWitnessHints ? {noteHashWitnessHints:utilityResult.noteHashWitnessHints} : {}),\n                    stats: utilityResult.stats,');
  replace('                result: returnValue,\n                ...offchainOutput','                ...(utilityResult.noteHashWitnessHints ? {noteHashWitnessHints:utilityResult.noteHashWitnessHints} : {}),\n                result: returnValue,\n                ...offchainOutput');
  return source;
 }
 source=preservePxeSimulationLogs(source);
 replace('        try {\n            this.log.verbose(`Executing utility function', `        const finishNoteWitnessHints=await rollingSelectedNoteCapture(oracle,call,entryPointArtifact,scopes,anchoredContractData,this.contractStore,anchorBlockHeader);
        try {
            this.log.verbose(\`Executing utility function`);
 replace('                result: witnessMapToFields(acirExecutionResult.returnWitness),\n                offchainEffects: oracle.getOffchainEffects()', '                result: witnessMapToFields(acirExecutionResult.returnWitness),\n                noteHashWitnessHints:await finishNoteWitnessHints(),\n                offchainEffects: oracle.getOffchainEffects()');
 return source+`
async function rollingSelectedNoteCapture(oracle,call,artifact,scopes,contracts,store,header){
 const absent=async()=>undefined;
 try{
  if(artifact.name!=='get_screen_hints'||scopes?.length!==1||call.args.length!==2||!call.args[0].equals(Fr.fromString(scopes[0].toString()))||!call.selector.equals(await FunctionSelector.fromNameAndParameters(artifact.name,artifact.parameters)))return absent;
  const classId=await contracts.getCurrentClassId(call.to);
  if(!classId)return absent;
  const boardArtifact=await store.getContractArtifact(classId),slot=boardArtifact?.storageLayout?.posts?.slot,depositSlotValue=boardArtifact?.storageLayout?.deposits?.slot;
  if(boardArtifact?.name!=='RollingBoard'||slot===undefined||depositSlotValue===undefined)return absent;
  const postSlot=new Fr(BigInt(slot)),depositSlot=new Fr(BigInt(depositSlotValue)),owner=scopes[0],selected=[];let valid=true,deposit;
  const original=oracle.getNotes.bind(oracle);
  oracle.getNotes=async(...args)=>{
   const result=await original(...args);
   if(args[1].equals(depositSlot)){
    if(args[2]!==1||args[12]!==2||args[13]!==0||args[15]!==2||result.data.length!==1||deposit)valid=false;
    else{const note=result.data[0];if(note.isPending||!note.contractAddress.equals(call.to)||!note.owner.equals(owner)||!note.storageSlot.equals(depositSlot))valid=false;
     else deposit={contractAddress:note.contractAddress,noteHash:note.noteHash,noteNonce:note.noteNonce};}
   }
   if(args[1].equals(postSlot)){
    if(args[2]!==2||args[12]!==2||args[13]!==0||args[15]!==2||result.data.length!==1||selected.length>=2)valid=false;
    else{const note=result.data[0];if(note.isPending||!note.contractAddress.equals(call.to)||!note.owner.equals(owner)||!note.storageSlot.equals(postSlot))valid=false;
     else selected.push({contractAddress:note.contractAddress,noteHash:note.noteHash,noteNonce:note.noteNonce});}
   }
   return result;
  };
  return async()=>{
   if(!valid)return undefined;
   try{return {board:call.to.toString(),owner:owner.toString(),anchorHash:(await header.hash()).toString(),
    ...(deposit?{depositHash:(await computeUniqueNoteHash(deposit.noteNonce,await siloNoteHash(deposit.contractAddress,deposit.noteHash))).toString()}:{}),
    hashes:await allToCompletion(selected.map(async note=>(await computeUniqueNoteHash(note.noteNonce,await siloNoteHash(note.contractAddress,note.noteHash))).toString()))};}
   catch{return undefined;}
  };
 }catch{return absent;}
}
`;

}
