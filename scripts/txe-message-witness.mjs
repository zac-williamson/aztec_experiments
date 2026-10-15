// Pinned TXE-only repair: finish both reads before a failed oracle can dispose its
// session. Neither the application SDK bundle nor installed package is modified.
import {createHash} from 'node:crypto';
export function drainMessageWitnessReads(source){
 source=String(source);
 if(createHash('sha256').update(source).digest('hex')!=='426bda7e56cb220f8b81c7c2a457ac312c79f45031e49147dc80eb61faaa6651')throw Error('Pinned TXE message-witness source changed; review the lifecycle repair');
 const needle='const [l1ToL2Response, nullifierResponse] = await Promise.all([';
 if(source.split(needle).length!==2)throw Error('Pinned TXE message-witness join changed');
 return "import {allToCompletion} from '@aztec-labs/foundation/promise';\n"+source.replace(needle,'const [l1ToL2Response, nullifierResponse] = await allToCompletion([');
}
