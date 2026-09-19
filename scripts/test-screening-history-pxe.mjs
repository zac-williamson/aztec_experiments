// Actual native storage; shared synthetic history/query assertions, not transaction proofs.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AztecLMDBStoreV2} from '@aztec/kv-store/lmdb-v2';
import {checkScreeningHistory} from './screening-history-fixture.mjs';
const directory=await mkdtemp(join(tmpdir(),'billboard-c04-note-store-'));
try{
 const result=await checkScreeningHistory(()=>AztecLMDBStoreV2.new(directory,16*1024,4));
 console.log(JSON.stringify(result,null,2));
}finally{await rm(directory,{recursive:true,force:true});}
