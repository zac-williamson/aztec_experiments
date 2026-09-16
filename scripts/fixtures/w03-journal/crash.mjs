import fs from 'node:fs';
import {Tx} from '@aztec/stdlib/tx';
import {createL2Journal} from '../../../shared/l2-journal.mjs';
import {createFileJournalStorage} from '../../../apps/src/billboard/user/transaction-journal-store.mjs';
const {directory,tx,...options}=JSON.parse(fs.readFileSync(0,'utf8'));
const journal=await createL2Journal({...options,Tx,node:{},storage:createFileJournalStorage(directory)});
await journal.prepare(Tx.fromBuffer(Buffer.from(tx,'hex')),await journal.assertCanStart());
process.kill(process.pid,'SIGKILL');
