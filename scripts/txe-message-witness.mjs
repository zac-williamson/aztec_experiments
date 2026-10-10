// Pinned TXE-only repair: finish both reads before a failed oracle can dispose its
// session. Neither the application SDK bundle nor installed package is modified.
import {createHash} from 'node:crypto';
export function drainMessageWitnessReads(source){
 source=String(source);
 if(createHash('sha256').update(source).digest('hex')!=='377811b38fb552c6f544a323dddf8f7706a913c725f92049fbe1b2189a47d7ae')throw Error('Pinned TXE message-witness source changed; review the lifecycle repair');
 return "import {allToCompletion} from '@aztec-labs/foundation/promise';\n"+source
  .replace('const l1ToL2Response = await l1ToL2ResponsePromise;', 'const [l1ToL2Response, nullifierResponse] = await allToCompletion([l1ToL2ResponsePromise, nullifierResponsePromise]);')
  .replace('    const nullifierResponse = await nullifierResponsePromise;\n','');
}
