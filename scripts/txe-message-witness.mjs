// Pinned TXE-only repair: finish both reads before a failed oracle can dispose its
// session. Neither the application SDK bundle nor installed package is modified.
import {createHash} from 'node:crypto';
export function drainMessageWitnessReads(source){
 source=String(source);
 if(createHash('sha256').update(source).digest('hex')!=='1a28f10c13e9315673b2a9aab90f6f2735a09a326aafb6c2720708e99e3f7d05')throw Error('Pinned TXE message-witness source changed; review the lifecycle repair');
 return "import {allToCompletion} from '@aztec/foundation/promise';\n"+source
  .replace('const l1ToL2Response = await l1ToL2ResponsePromise;', 'const [l1ToL2Response, nullifierResponse] = await allToCompletion([l1ToL2ResponsePromise, nullifierResponsePromise]);')
  .replace('    const nullifierResponse = await nullifierResponsePromise;\n','');
}
