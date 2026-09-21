import {DatabaseSync} from 'node:sqlite';
export function openDispatchStore(filename) {
  const db=new DatabaseSync(filename);
  db.exec('CREATE TABLE IF NOT EXISTS dispatched(id TEXT PRIMARY KEY, created INTEGER NOT NULL)');
  const claim=db.prepare('INSERT OR IGNORE INTO dispatched VALUES (?, ?)');
  return {claim:id=>claim.run(id,Date.now()).changes===1,close:()=>db.close()};
}
